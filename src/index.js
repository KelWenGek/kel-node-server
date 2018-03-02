const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const path = require('path');
const url = require('url');
const util = require('util');
const chalk = require('chalk');
const debug = require('debug')('static:server');
const statuses = require('statuses');
const mime = require('mime');
const pify = require('pify');
const handlebars = require('handlebars');
const { stat, readdir } = pify(fs);
class StaticSever {
    constructor(options) {
        this.server = http.createServer();
        this.config = Object.assign({}, StaticSever.config, options);
        this.compile = this.compileTemplate();
    }
    async request(req, res) {
        let { pathname } = url.parse(req.url);
        if (pathname === '/favicon.ico') {
            return this.sendError(404, req, res);
        }
        let filePath = path.join(this.config.root, pathname);
        const statObj = await stat(filePath);
        if (statObj.isDirectory()) {
            let files = await readdir(filePath);
            files = files.map(file => {
                return {
                    name: file,
                    url: path.join(pathname, file)
                }
            });
            let resHtml = this.compile({
                title: filePath,
                files
            });
            res.setHeader('Content-Type', 'text/html');
            res.end(resHtml);
        } else {
            this.sendFile(req, res, filePath, statObj);
        }
    }
    startServer(cb) {
        this.server.on('request', this.request.bind(this));
        this.server.listen(this.config.port, () => {
            let serverUrl = `${this.config.host}:${this.config.port}`;
            debug(`服务器已启动,地址为${chalk.green(serverUrl)}`);
            cb && typeof cb === 'function' && cb();
        })
    }
    sendFile(req, res, filePath, statObj) {
        res.setHeader('Content-Type', `${mime.getType(filePath)};charset=utf-8`);
        let encoding = this.getEncoding(req, res);
        if (this.getFileFromCache(req, res, statObj)) return;
        let writeStream = this.getWriteStream(req, res, filePath, statObj);
        if (encoding) {
            writeStream.pipe(encoding).pipe(res);
        } else {
            writeStream.pipe(res);
        }
    }
    getFileFromCache(req, res, statObj) {
        let ifModifiedSince = req.headers['if-modified-since'],
            ifNoneMatch = req.headers['if-none-match'];
        //设置缓存侧错
        res.setHeader('Cache-Control', 'private;max-age=60');
        res.setHeader('Expires', new Date(Date.now()).toUTCString());
        //设置缓存头
        let etag = crypto.createHash('sha1').update(statObj.ctime.toUTCString() + statObj.size).digest('hex');
        let lastModified = statObj.ctime.toGMTString();
        res.setHeader('Etag', etag);
        res.setHeader('Last-modified', lastModified);
        if ((ifNoneMatch && ifNoneMatch === etag) || (ifModifiedSince && ifModifiedSince === lastModified)) {
            res.statusCode = 304;
            res.end('');
            return true;
        }
        return false;
    }
    getEncoding(req, res) {
        let acceptEncoding = req.headers['accept-encoding'];
        if (acceptEncoding.match(/\bgzip\b/)) {
            res.setHeader('Content-Encoding', 'gzip');
            return zlib.createGzip();
        } else if (acceptEncoding.match(/\bdeflate\b/)) {
            res.setHeader('Content-Encoding', 'deflate');
            return zlib.createDeflate();
        } else {
            return null;
        }
    }
    getWriteStream(req, res, filePath, statObj) {
        let start = 0, end = statObj.size - 1, range = req.headers['range'];
        if (range) {
            res.setHeader('Accept-Range', 'bytes');
            res.statusCode = 206;
            let result = range.match(/bytes=(\d*)-(\d*)/);
            if (result) {
                start = isNaN(result[1]) ? start : parseInt(result[1]);
                end = isNaN(result[2]) ? end : parseInt(result[2]);
            }
        }
        return fs.createReadStream(filePath, {
            start, end
        });
    }
    sendError(code, req, res) {
        const msg = statuses[code];
        res.statusCode = code;
        res.end(msg);
    }
    compileTemplate() {
        try {
            let template = fs.readFileSync(path.resolve(__dirname, './template/index.html'), 'utf8');
            return handlebars.compile(template);
        } catch (error) {
            debug(`${util.inspect(error)}`);
        }
    }
}


StaticSever.config = {
    host: 'localhost',
    port: 8080,
    root: path.resolve(__dirname, '../static')
};
const ss = new StaticSever();
ss.startServer();