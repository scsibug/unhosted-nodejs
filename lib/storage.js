var nStore = require('nstore');
var util = require('util');
var Step = require('step');
var redis = require('redis');

/**
 * Base interface for all storage backends.
 *
 * This is just a template, you can inherit it if you want but you don't have
 * to.
 */
var StorageBackend = function(){
    this.initialized = false;
}
StorageBackend.prototype = {
    init: function(options, callback){
        var self = this;
        if(typeof options !== 'object') { callback = options; }

        process.nextTick(function(){
            self.initialized = true;
            callback(null);
        });
    }
    , set: function(chan, app, keyPath, value, callback){}
    , get: function(chan, app, keyPath, callback){}
    , send: function(chan, app, keyPath, value, callback){}
    , receive: function(chan, app, keyPath, andDelete, callback){}
}

/**
 * Redis storage backend
 */
redisStorageBackend = function(){
    this.client = null;
}
util.inherits(redisStorageBackend, StorageBackend);

redisStorageBackend.prototype = {
    init: function(options, callback){
        if(typeof options !== 'object') { callback = options; }
        if(!callback) { callback = function(){}; }
        
        var host = options.host || "127.0.0.1";
        var port = options.port || 6379;
        var db = options.db || 1;
        this.client = redis.createClient(port,host);
        this.client.select(db,function(err){
            if (err) { callback(err); return; };
            if(callback) {
                callback(null);
            }
        });
    }
    , set: function(chan, app, keyPath, value, callback){
        this.client.set('ent' + chan + app + keyPath, value, function(err){
            if(err) { callback(err); return; }
            callback(null);
        });
    }

    , get: function(chan, app, keyPath, callback){
        this.client.get('ent' + chan + app + keyPath, function(err, res){
            if(err) { callback(err); return; }
            callback(null, res);
        });
    }

    , send: function(chan, app, keyPath, value, callback){
        var self = this;
        this.client.rpush('msg' + chan + app + keyPath, function(err) {
            if (err) {
                callback(err);
                return;
            } else {
                callback(null);
            }               
        });
    }

    , receive: function(chan, app, keyPath, andDelete, callback){
        this.client.lrange('msg' + chan + app + keyPath, 0, -1, function(err, res){
            if(err) { callback(err); return; }
            if(andDelete) {
                this.client.del('msg' + chan + app + keyPath, function(err){
                    if(err) { callback(err); return; }
                    callback(null, res);
                });
            } else {
                callback(null, res);
            }
        });
    }
}
/**
 * Basic in process storage backend.
 */
nStoreStorageBackend = function(){
    this.store = null;
}
util.inherits(nStoreStorageBackend, StorageBackend);

nStoreStorageBackend.prototype = {
    init: function(options, callback){
        if(typeof options !== 'object') { callback = options; }
        if(!callback) { callback = function(){}; }


        var path = options.path || process.cwd() + '/data/unhosted-store.db';
        this.store = nStore.new(path, function(err){
            if(err) { callback(err); return; };

            if(callback) {
                callback(null);
                callback = null;
            }
        });
    }

    , set: function(chan, app, keyPath, value, callback){
        this.store.save('ent' + chan + app + keyPath, { value: value }
                        , function(err){
                            if(err) { callback(err); return; }

                            callback(null);
                        });
    }

    , get: function(chan, app, keyPath, callback){
        this.store.get('ent' + chan + app + keyPath, function(err, doc, key){
            if(err) { callback(new Error('Cannot get key ' + keyPath)); return; }

            callback(null, doc.value);
        });
    }

    , send: function(chan, app, keyPath, value, callback){
        var self = this;

        Step(
            function fetch_messages(){
                self.store.get('msg' + chan + app + keyPath, this);
            }
            , function append_message(err, doc, key){
                var messages = null;

                if(err && err.errno == process.ENOENT) {
                    messages = [];
                } else if (err) {
                    callback(err);
                    return;
                } else {
                    messages = doc.messages;
                }

                messages.push(value);

                self.store.save('msg' + chan + app + keyPath
                                , { messages: messages }, this);
            }
            , function save_done(err){
                if(err) { callback(err); return; }

                callback(null);
            }
        )
    }

    , receive: function(chan, app, keyPath, andDelete, callback){
        this.store.get('msg' + chan + app + keyPath, function(err, doc, key){
            if(err) { callback(err); return; }

            if(andDelete) {
                this.store.remove(key, function(err){
                    if(err) { callback(err); return; }

                    callback(null, doc.messages);
                });
            } else {
                callback(null, doc.messages);
            }
        });
    }
}


exports.StorageBackend = StorageBackend;
exports.nStoreStorageBackend = nStoreStorageBackend;
exports.redisStorageBackend = redisStorageBackend;