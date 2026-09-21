# Deployed Lambda business-logic excerpts

Read-only deployment inspection on 2026-09-20. These are selected formatted excerpts, not runnable modules. Original handler and ZIP hashes are in aws-readonly-evidence-2026-09-20.json. Configuration/credentials and full bundles are intentionally excluded. Variable names come from the minified deployment.

## lambda_weatherbycoord — formatted lines 910–1084

```js
  const r = o(0), s = o(4), n = o(16), a = o(1);
  e.exports = class {
    constructor() {
      (this.geoCode = new n(), this.lang = "en", this.url = a.serviceServer.url, this.version = a.serviceServer.version);
    }
    _request(e, t) {
      console.info({
        _request: {
          url: e
        }
      });
      let o = {
        json: !0,
        timeout: 3e3,
        headers: {
          "Accept-Language": this.lang
        },
        gzip: !0
      };
      s(e, o, (o, r, s) => o ? t(o) : r.statusCode >= 400 ? (o = new Error("url=" + e + " statusCode=" + r.statusCode), t(o)) : void t(o, s));
    }
    _requestRetry(e, t) {
      let o = new Date();
      r.retry(3, t => {
        this._request(e, (o, r) => {
          if (o) return (console.warn(o.message, e), t(o));
          t(null, r);
        });
      }, (e, r) => {
        if ((console.info({
          twServiceResponseTime: new Date().getTime() - o.getTime()
        }), e)) return t(e);
        t(null, r);
      });
    }
    _requests(e, t) {
      let o;
      r.someSeries(e, (e, t) => {
        let r = new Date();
        this._request(e, function (s, n) {
          if (s) return (console.warn(s.message, e), t(null, !s));
          (console.info({
            twServiceResponseTime: new Date().getTime() - r.getTime()
          }), o = n, t(null, !s));
        });
      }, (e, r) => {
        if (e) return t(e);
        (!1 === r && (e = new Error("Fail to get weather data")), t(e, o));
      });
    }
    _geoinfo2url(e, t, o) {
      let r = e + "/" + t;
      return "KR" === o.country ? (r += "/kma/addr", o.kmaAddress.name1 && o.kmaAddress.name1.length > 0 && (r += "/" + encodeURIComponent(o.kmaAddress.name1)), o.kmaAddress.name2 && o.kmaAddress.name1.length > 0 && (r += "/" + encodeURIComponent(o.kmaAddress.name2)), o.kmaAddress.name3 && o.kmaAddress.name1.length > 0 && (r += "/" + encodeURIComponent(o.kmaAddress.name3)), r) : (r += "/dsf/coord", r += "/" + o.loc[0] + "," + o.loc[1]);
    }
    _appendQueryParameters(e, t) {
      let o, r = 0;
      if (!t || !t.hasOwnProperty("queryStringParameters")) return e;
      o = t.queryStringParameters;
      for (let t in o) (e += 0 === r ? "?" : "&", e += t + "=" + o[t], r++);
      return e;
    }
    _getLanguage(e) {
      return e.headers ? e.headers.hasOwnProperty("Accept-Language") ? e.headers["Accept-Language"].split("-")[0] : e.headers.hasOwnProperty("accept-language") ? e.headers["accept-language"].split("-")[0] : (console.error("Fail to find accept-language"), "en") : (console.error("Fail to find headers"), "en");
    }
    _makeUrls(e, t) {
      let o, r, s = [];
      return (r = t && t.pathParameters && t.pathParameters.version || this.version, o = this._geoinfo2url(this.url, r, e), o = this._appendQueryParameters(o, t), s.push(o), s);
    }
    _coord2geoInfo(e, t) {
      this.geoCode.coord2geoInfo(e, t);
    }
    _importGeoInfo(e, t) {
      this.geoCode.importGeoInfo(e, t);
    }
    byCoord(e, t) {
      try {
        this.lang = this._getLanguage(e);
      } catch (e) {
        console.error(e);
      }
      r.waterfall([t => {
        this._coord2geoInfo(e, (e, o) => {
          t(e, o);
        });
      }, (t, o) => {
        let r;
        try {
          if ((console.info({
            geoInfo: t
          }), !(r = this._makeUrls(t, e)))) throw new Error("Fail to make urls");
        } catch (e) {
          return o(e);
        }
        (console.info("URL : ", JSON.stringify(r)), this._requestRetry(r[0], (e, r) => {
          if (e) return o(e);
          try {
            this._importGeoInfo(r, t);
          } catch (e) {
            return o(e);
          }
          o(null, r);
        }));
      }], (e, o) => {
        if (e) return t(e);
        t(null, o);
      });
    }
    byAddress(e, t) {
      return (console.error(e), t(new Error("This event is not supported yet!")));
    }
  };
}, function (e, t) {
  e.exports = require("http");
}, function (e, t) {
  e.exports = require("aws-xray-sdk-core");
}, function (e, t, o) {
  "use strict";
  if (!process.env.IS_OFFLINE) {
    const e = o(19);
    (e.captureAWS(o(5)), e.captureHTTPsGlobal(o(18)));
  }
  o(1);
  const r = o(17);
  (o(7), o(6)({
    enable: !0,
    ttl: 300,
    cachesize: 1e3
  }));
  function s(e, t, o) {
    return e ? (e.hasOwnProperty("statusCode") ? e.statusCode >= 500 ? console.error(e) : e.statusCode >= 400 && console.warn({
      Warning: e.message,
      statusCode: e.statusCode
    }) : console.error(e), {
      statusCode: e.statusCode || 501,
      headers: {
        "Content-Type": "text/plain"
      },
      body: e.toString()
    }) : {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "cache-control": "max-age=" + o,
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(t)
    };
  }
  (e.exports.weatherbycoord = (e, t, o) => {
    new r().byCoord(e, (e, t) => {
      let r;
      try {
        r = s(e, t, 300);
      } catch (e) {
        return o(e);
      }
      o(null, r);
    });
  }, e.exports.weatherbyaddr = (e, t, o) => {
    new r().byAddress(e, (e, t) => {
      let r;
      try {
        r = s(e, t, 300);
      } catch (e) {
        return o(e);
      }
      o(null, r);
    });
  });
}]));
```

## lambda_weatherbyaddr — formatted lines 1017–1019

```js
    byAddress(e, t) {
      return (console.error(e), t(new Error("This event is not supported yet!")));
    }
```

## lambda_geoinfobycoord — formatted lines 780–900

```js
      });
    }
    _updateGeoCodeDb(e, t) {
      this.ctrlGeoCodeDb.update(e, (e, o) => {
        t(e, o);
      });
    }
    _isExpired(e) {
      const t = new Date().getTime();
      return e.updatedAt ? e.updatedAt < t - 2592e6 : (console.error("geoInfo updatedAt is invalid"), !0);
    }
    _getLanguage(e) {
      return e.headers ? e.headers.hasOwnProperty("Accept-Language") ? e.headers["Accept-Language"].split("-")[0] : e.headers.hasOwnProperty("accept-language") ? e.headers["accept-language"].split("-")[0] : (console.warn("Fain to find accept-language"), "en") : (console.warn("Fain to find headers"), "en");
    }
    importGeoInfo(e, t) {
      if (void 0 == e) throw new Error("dest is undefined");
      ["label", "country", "address", "loc"].forEach(o => {
        t.hasOwnProperty(o) && ("label" === o ? e.name = t.label : "loc" === o ? e.location = {
          lat: t.loc[0],
          long: t.loc[1]
        } : e[o] = t[o]);
      });
    }
    coord2geoInfo(e, t) {
      let o, r;
      try {
        console.log(e);
        let s = decodeURIComponent(e.pathParameters.loc).split(",");
        if ((o = [Number(s[0]), Number(s[1])], o = this._geoCodeNormalize(o), r = this._getLanguage(e), 0 === o[0] && 0 === o[1])) {
          let e = new Error("Invalid path parameters");
          return (e.statusCode = 404, t(e));
        }
        console.info({
          coord2geoInfo: {
            loc: o,
            lang: r
          }
        });
      } catch (e) {
        return t(e);
      }
      s.tryEach([e => {
        this._getFromGeoCodeDb(o, r, (t, o) => t ? e(t) : "KR" === o.country && void 0 == o.kmaAddress ? (t = new Error("this data is invalid geoInfo:" + JSON.stringify(o)), console.error(t), e(t)) : this._isExpired(o) ? (t = new Error("this data is expired geoInfo:" + JSON.stringify(o)), console.warn(t.message), e(t)) : void e(t, o));
      }, e => {
        this._getFromGeoCodeApi(o, r, (t, o) => {
          if (t) return e(t);
          (this._updateGeoCodeDb(o, e => {
            e && console.error(e);
          }), e(t, o));
        });
      }], (e, o) => {
        if (e) return t(e);
        t(e, o);
      });
    }
    byCoord(e, t) {
      this.coord2geoInfo(e, (e, o) => {
        if (e) return t(e);
        let s = {};
        try {
          (this.importGeoInfo(s, o), o.kmaAddress && (s.kmaAddress = o.kmaAddress));
        } catch (e) {
          return t(e);
        }
        t(e, s);
      });
    }
    _getFromAddressDb(e, t) {
      this.ctrlAddressDb.get(e, (e, o) => {
        t(e, o);
      });
    }
    _getFromAddressApi(e, t) {
      this.ctrlGeoApi.getGeoInfoByAddr(e, (e, o) => {
        t(e, o);
      });
    }
    _updateAddressDb(e, t) {
      this.ctrlAddressDb.update(e, (e, o) => {
        t(e, o);
      });
    }
    addr2geoInfo(e, t) {
      let o;
      try {
        if ((console.log(e), !e.pathParameters.address)) throw new Error("Invalid address parameter");
        (o = decodeURIComponent(e.pathParameters.address), console.info({
          byAddr: {
            addr: o
          }
        }));
      } catch (e) {
        return t(e);
      }
      s.tryEach([e => {
        this._getFromAddressDb(o, (t, o) => {
          if (t) return e(t);
          e(t, o);
        });
      }, e => {
        this._getFromAddressApi(o, (t, o) => {
          if (t) return e(t);
          (o.loc = this._geoCodeNormalize(o.loc), this._updateAddressDb(o, e => {
            e && console.error(e);
          }), e(t, o));
        });
      }], (e, o) => {
        if (e) return t(e);
        t(e, o);
      });
    }
    byAddr(e, t) {
      this.addr2geoInfo(e, (e, o) => {
        if (e) return t(e);
        let s = {};
        try {
          this.importGeoInfo(s, o);
        } catch (e) {
          return t(e);
        }
        t(e, s);
```

## lambda_copyKaqfsImagesToS3 — formatted lines 69–176

```js
    _getDate(e) {
      let t;
      try {
        let s, o = e[0].description.split("\n");
        for (s = 0; s < o.length && !(o[s].length >= 19); s++) ;
        if (s == o.length) throw Error("Fail to find date information");
        (t = (t = o[s]).slice(0, 19), console.info({
          date: t
        }));
      } catch (t) {
        throw (console.error(JSON.stringify(e)), t);
      }
      return t;
    }
    _getDateOfKaqfsImage(e, t) {
      (e = e || this.imgPathPrefixs[0], t = t || this.pollutantList[0]);
      let s = this.imgPathUrl + "/" + e + "/" + t + "." + this.areaList[0] + "." + this.jpegPostfix;
      return this._textDetection(s).then(e => {
        const t = e[0].textAnnotations;
        return (e[0].error && console.error(e[0].error), t);
      }).then(e => this._getDate(e));
    }
    _getGifImageList(e, t) {
      let s = [];
      return (this.areaList.forEach(o => {
        if (t) {
          let r = this.imgPathUrl + "/" + e + "/" + t + "." + o + "." + this.animationPostfix;
          s.push({
            url: r,
            s3Path: e + "." + t + "." + o + "." + this.animationPostfix
          });
        } else this.pollutantList.forEach(t => {
          let r = this.imgPathUrl + "/" + e + "/" + t + "." + o + "." + this.animationPostfix;
          s.push({
            url: r,
            s3Path: e + "." + t + "." + o + "." + this.animationPostfix
          });
        });
      }), s);
    }
    _uploadListToS3(e) {
      return new Promise((t, s) => {
        o.mapLimit(e, 3, (e, t) => {
          this.ctrlS3.upload(e.url, e.s3Path).then(e => {
            t(null, e);
          }).catch(e => {
            t(e);
          });
        }, (e, o) => {
          if (e) return s(e);
          t(o);
        });
      });
    }
    _copyS3ListToDest(e, t) {
      return new Promise((s, r) => {
        o.mapLimit(e, 3, (e, s) => {
          let o = e.Key.split("/"), r = this.bucket + "/" + e.Key, n = t + o[1] + "_" + new Date().toISOString() + "_" + o[0];
          (console.info({
            dest: n,
            src: r
          }), this.ctrlS3.copy(n, r).then(e => {
            s(null, e);
          }).catch(e => {
            s(e);
          }));
        }, (e, t) => {
          if (e) return r(e);
          s(t);
        });
      });
    }
    _copyNewImagesToS3EachModel(e, t) {
      o.retry(3, t => {
        this._getDateOfKaqfsImage(e).then(t => this._getGifImageList(e).map(e => (e.s3Path = t + "/" + e.s3Path, e))).then(e => this._uploadListToS3(e)).then(e => {
          t(null, e);
        }).catch(e => {
          (console.error(e), t(e));
        });
      }, (e, s) => {
        if (e) return t(e);
        t(null, s);
      });
    }
    _copyNewImagesToS3EachArea(e, t, s) {
      o.retry(3, s => {
        this._getDateOfKaqfsImage(e, t).then(s => this._getGifImageList(e, t).map(e => (e.s3Path = s + "/" + e.s3Path, e))).then(e => this._uploadListToS3(e)).then(e => {
          s(null, e);
        }).catch(e => {
          (console.error(e), s(e));
        });
      }, (e, t) => {
        s(e, t);
      });
    }
    _copyNewImagesToS3EachPollutant(e, t) {
      o.mapSeries(this.pollutantList, (t, s) => {
        this._copyNewImagesToS3EachArea(e, t, s);
      }, (e, s) => {
        t(e, s);
      });
    }
    copyNewImagesToS3(e) {
      o.mapSeries(this.imgPathPrefixs, (e, t) => {
        this._copyNewImagesToS3EachPollutant(e, t);
      }, (t, s) => t ? (console.error(t), e(t)) : e(t, s));
    }
  };
```
