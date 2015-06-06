/*jslint node: true */
'use strict';
var ansi = require("bp-utilities").ansi,
    mime = require("bp-utilities").mime,
    q = require("q"),
    fs = require("fs"),
    promiseConstructor = q.resolve(1).constructor,
    querystring = require("querystring"),
    HttpServer = function (config) {
        var that = this, p;
        that.funcList = [];
        for (p in config) {
            if (config.hasOwnProperty(p)) {
                that[p] = config[p];
            }
        }
        that.use = function (fn) {
            that.funcList.push(fn);
        };
        that.next = function () {
            return q.resolve(arguments);
        };
        that.enhanceRequest = function (req) {
            // First check if the request was proxied,
            // then if any of the other variables are
            // set depending on the connection type
            req.ip = req.headers['x-forwarded-for'] ||
                     req.connection.remoteAddress ||
                     req.socket.remoteAddress ||
                     req.connection.socket.remoteAddress;
            return req;
        };
        that.enhanceResponse = function (res) {
            res.finished = false;
            res.json = function json(obj) {
                this.send(JSON.stringify(obj), {'Content-Type': 'application/json'});
            };
            res.error = function error(code, obj) {
                this.writeHead(code, { 'Content-Type': 'application/json' });
                this.json(obj);
            };
            res.send = function send(data, headers) {
                headers = headers || {'Content-Type': 'text/plain'};
                if (!this.headersSent) {
                    this.writeHead(200, headers);
                }
                this.write(data);
                this.finish();
            };
            res.sendFileStream = function sendFileStream(fileStream, stat) {
                if (!this.headersSent) {
                    this.writeHead(200, {
                        'Content-Type': mime.find(stat.filepath),
                        'Content-Length': stat.size
                    });
                }
                fileStream.on("end", function () {
                    res.finish();
                });
                fileStream.pipe(this);
            };
            res.sendFile = function (req, path) {
                var results = q.defer();
                fs.readFile(path, function (err, file) {
                    if (err) {
                        results.reject(err);
                    } else {
                        res.send(file, {'Content-Type': mime.find(path)});
                        results.resolve([req, res]);
                    }
                });
                return results.promise;
            };
            res.finish = function finish() {
                this.end();
                this.finished = true;
            };
            return res;
        };
        that.asd = 0;
        that.listen = function listen(http) {
            that.funcList.push(function ensureEnd(req, res, next) {
                if (!res.finished) {
                    res.finish();
                }
                return next();
            });
            that.server = http.createServer(function (req, res) {
                var reqx = that.enhanceRequest(req),
                    resx = that.enhanceResponse(res),
                    i,
                    core = q.defer(),
                    wrapfunc = function (fn, req, res) {
                        var boundNext = that.next.bind(fn, req, res),
                            result;
                        if (res.finished) {
                            return boundNext();
                        } else {
                            result = fn(req, res, boundNext);
                            if (typeof result === 'object' && result.constructor === promiseConstructor) {
                                return result;
                            } else {
                                return q(boundNext());
                            }
                        }
                    };

                resx.on("finish", function () {
                    var col = ansi.green;
                    if (resx.statusCode >= 300) {
                        col = ansi.blue;
                    }
                    if (resx.statusCode >= 400) {
                        col = ansi.red;
                    }

                    console.log(req.method + " " + ansi.bold(col(resx.statusCode)) + " " + reqx.url);
                    if (reqx.db) {
                        reqx.db.close();
                    }
                });

                that.funcList.reduce(function (soFar, f) {
                    return soFar.spread(wrapfunc.bind(f, f));
                }, q([reqx, resx])).done();

            }).listen(that.port);

            console.log(ansi.blue(that.appname) + " now listening on port " + ansi.magenta(that.port));
            return that.server;
        };
    };

module.exports = function HttpServerWrapper(conf) {
    return new HttpServer(conf);
};