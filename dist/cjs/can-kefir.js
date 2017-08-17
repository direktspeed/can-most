/*can-kefir@0.0.3#can-kefir*/
var canReflect = require('can-reflect');
var canSymbol = require('can-symbol');
var dev = require('can-util/js/dev/dev');
var Kefir = require('kefir');
var Observation = require('can-observation');
var CID = require('can-cid');
var canBatch = require('can-event/batch/batch');
var observeDataSymbol = canSymbol.for('can.observeData');
function getObserveData(stream) {
    var observeData = stream[observeDataSymbol];
    if (!observeData) {
        observeData = Object.create(null);
        observeData.onValueHandlers = [];
        observeData.onErrorHandlers = [];
        Object.defineProperty(stream, observeDataSymbol, {
            enumerable: false,
            configurable: false,
            writable: false,
            value: observeData
        });
    }
    return observeData;
}
var replaceWith = function (obj, prop, cb, writable) {
    Object.defineProperty(obj, prop, {
        configurable: true,
        get: function () {
            Object.defineProperty(this, prop, {
                value: undefined,
                writable: true,
                configurable: true
            });
            var value = cb.call(this, obj, prop);
            Object.defineProperty(this, prop, {
                value: value,
                writable: !!writable
            });
            return value;
        },
        set: function (value) {
            Object.defineProperty(this, prop, {
                value: value,
                writable: !!writable
            });
            return value;
        }
    });
};
replaceWith(Kefir.Observable.prototype, '_cid', function () {
    return CID({});
});
var keyNames = {
    'value': {
        on: 'onValue',
        handlers: 'onValueHandlers',
        off: 'offValue',
        handler: 'onValueHandler'
    },
    'error': {
        on: 'onError',
        handlers: 'onErrorHandlers',
        off: 'offError',
        handler: 'onErrorHandler'
    }
};
function getCurrentValue(stream, key) {
    if (stream._currentEvent && stream._currentEvent.type === key) {
        return stream._currentEvent.value;
    } else {
        var names = keyNames[key];
        var VALUE, valueHandler = function (value) {
                VALUE = value;
            };
        stream[names.on](valueHandler);
        stream[names.off](valueHandler);
        return VALUE;
    }
}
canReflect.assignSymbols(Kefir.Observable.prototype, {
    'can.onKeyValue': function (key, handler) {
        var names = keyNames[key];
        var observeData = getObserveData(this);
        var handlers = observeData[names.handlers];
        if (handlers.length === 0) {
            var stream = this;
            var onHandler = observeData[names.handler] = function (value) {
                if (value !== observeData[key]) {
                    observeData[key] = value;
                    handlers.forEach(function (handler) {
                        canBatch.queue([
                            handler,
                            stream,
                            [value]
                        ]);
                    });
                }
            };
            handlers.push(handler);
            this[names.on](onHandler);
        } else {
            handlers.push(handler);
        }
    },
    'can.offKeyValue': function (key, handler) {
        var names = keyNames[key];
        var observeData = getObserveData(this);
        var handlers = observeData[names.handlers];
        var index = handlers.indexOf(handler);
        if (index !== -1) {
            handlers.splice(index, 1);
            if (handlers.length === 0) {
                this[names.off](observeData[names.handler]);
                delete this[observeDataSymbol];
            }
        }
    },
    'can.getKeyValue': function (key) {
        Observation.add(this, key);
        if (!this[observeDataSymbol]) {
            var observeData = getObserveData(this);
            var currentValue = getCurrentValue(this, key);
            return observeData[key] = currentValue;
        }
        return getObserveData(this)[key];
    }
});
Kefir.emitterProperty = function () {
    var emitter;
    var setLastValue = false;
    var lastValue, lastError;
    var stream = Kefir.stream(function (EMITTER) {
        emitter = EMITTER;
        if (setLastValue) {
            emitter.value(lastValue);
        }
        return function () {
            emitter = undefined;
        };
    });
    var property = stream.toProperty(function () {
        return lastValue;
    });
    property.value = stream.emit = function (newValue) {
        if (emitter) {
            return emitter.value(newValue);
        } else {
            setLastValue = true;
            lastValue = newValue;
        }
    };
    property.error = function (error) {
        if (emitter) {
            return emitter.error(error);
        } else {
            lastError = error;
        }
    };
    canReflect.assignSymbols(property, {
        'can.setKeyValue': function (key, value) {
            this[key](value);
        }
    });
    return property;
};
module.exports = Kefir;