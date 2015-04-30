import EventEmitter from 'eventemitter3'
import assign from 'object-assign'
import Symbol from 'es-symbol'

import * as Sym from './symbols/symbols'
import * as utils from './utils/AltUtils'

// event emitter instance
const EE = Symbol()

class AltStore {
  constructor(alt, model, state, StoreModel) {
    this[EE] = new EventEmitter()
    this[Sym.LIFECYCLE] = {}
    this[Sym.STATE_CONTAINER] = state || model

    this._storeName = model._storeName
    this.boundListeners = model[Sym.ALL_LISTENERS]
    this.StoreModel = StoreModel
    if (typeof this.StoreModel === 'object') {
      this.StoreModel.state = assign({}, StoreModel.state)
    }

    assign(this[Sym.LIFECYCLE], model[Sym.LIFECYCLE])
    assign(this, model[Sym.PUBLIC_METHODS])

    // Register dispatcher
    this.dispatchToken = alt.dispatcher.register((payload) => {
      if (model[Sym.LIFECYCLE].beforeEach) {
        model[Sym.LIFECYCLE].beforeEach(payload, this[Sym.STATE_CONTAINER])
      }

      if (model[Sym.LISTENERS][payload.action]) {
        let result = false

        try {
          result = model[Sym.LISTENERS][payload.action](payload.data)
        } catch (e) {
          if (this[Sym.LIFECYCLE].error) {
            this[Sym.LIFECYCLE].error(e, payload, this[Sym.STATE_CONTAINER])
          } else {
            throw e
          }
        }

        if (result !== false) {
          this.emitChange()
        }
      }

      if (model[Sym.LIFECYCLE].afterEach) {
        model[Sym.LIFECYCLE].afterEach(payload, this[Sym.STATE_CONTAINER])
      }
    })

    if (this[Sym.LIFECYCLE].init) {
      this[Sym.LIFECYCLE].init()
    }
  }

  getEventEmitter() {
    return this[EE]
  }

  emitChange() {
    this[EE].emit('change', this[Sym.STATE_CONTAINER])
  }

  listen(cb) {
    this[EE].on('change', cb)
    return () => this.unlisten(cb)
  }

  unlisten(cb) {
    if (this[Sym.LIFECYCLE].unlisten) {
      this[Sym.LIFECYCLE].unlisten()
    }
    this[EE].removeListener('change', cb)
  }

  getState() {
    return this.StoreModel.config.getState.call(
      this,
      this[Sym.STATE_CONTAINER]
    )
  }
}

function doSetState(store, storeInstance, state) {
  if (!state) {
    return
  }

  const { config } = storeInstance.StoreModel

  const nextState = typeof state === 'function'
    ? state(storeInstance[Sym.STATE_CONTAINER])
    : state

  storeInstance[Sym.STATE_CONTAINER] = config.setState.call(
    store,
    storeInstance[Sym.STATE_CONTAINER],
    nextState
  )

  if (!store.alt.dispatcher.isDispatching()) {
    store.emitChange()
  }
}

export function createStoreConfig(globalConfig, StoreModel) {
  StoreModel.config = assign({
    getState(state) {
      return Object.keys(state).reduce((obj, key) => {
        obj[key] = state[key]
        return obj
      }, {})
    },
    setState: assign
  }, globalConfig, StoreModel.config)
}

export function transformStore(transforms, StoreModel) {
  return transforms.reduce((Store, transform) => transform(Store), StoreModel)
}

export function createStoreFromObject(alt, StoreModel, key) {
  let storeInstance

  const StoreProto = {}
  StoreProto[Sym.ALL_LISTENERS] = []
  StoreProto[Sym.LIFECYCLE] = {}
  StoreProto[Sym.LISTENERS] = {}

  assign(StoreProto, {
    _storeName: key,
    alt,
    dispatcher: alt.dispatcher,
    getInstance() {
      return storeInstance
    },
    setState(nextState) {
      doSetState(this, storeInstance, nextState)
    }
  }, StoreMixinListeners, StoreMixinEssentials, StoreModel)

  // bind the store listeners
  /* istanbul ignore else */
  if (StoreProto.bindListeners) {
    StoreMixinListeners.bindListeners.call(
      StoreProto,
      StoreProto.bindListeners
    )
  }

  // bind the lifecycle events
  /* istanbul ignore else */
  if (StoreProto.lifecycle) {
    Object.keys(StoreProto.lifecycle).forEach((event) => {
      StoreMixinListeners.on.call(
        StoreProto,
        event,
        StoreProto.lifecycle[event]
      )
    })
  }

  // create the instance and assign the public methods to the instance
  storeInstance = assign(
    new AltStore(alt, StoreProto, StoreProto.state, StoreModel),
    StoreProto.publicMethods,
    { displayName: key }
  )

  return storeInstance
}

export function createStoreFromClass(alt, StoreModel, key, ...argsForClass) {
  let storeInstance
  const { config } = StoreModel

  // Creating a class here so we don't overload the provided store's
  // prototype with the mixin behaviour and I'm extending from StoreModel
  // so we can inherit any extensions from the provided store.
  class Store extends StoreModel {
    constructor(...args) {
      super(...args)
    }
  }

  assign(Store.prototype, StoreMixinListeners, StoreMixinEssentials, {
    _storeName: key,
    alt: alt,
    dispatcher: alt.dispatcher,
    getInstance() {
      return storeInstance
    },
    setState(nextState) {
      doSetState(this, storeInstance, nextState)
    }
  })

  Store.prototype[Sym.ALL_LISTENERS] = []
  Store.prototype[Sym.LIFECYCLE] = {}
  Store.prototype[Sym.LISTENERS] = {}
  Store.prototype[Sym.PUBLIC_METHODS] = {}

  const store = new Store(...argsForClass)

  storeInstance = assign(
    new AltStore(
      alt,
      store,
      store[alt.config.stateKey] || store[config.stateKey] || null,
      StoreModel
    ),
    utils.getInternalMethods(StoreModel),
    { displayName: key }
  )

  return storeInstance
}

const StoreMixinEssentials = {
  waitFor(sources) {
    if (!sources) {
      throw new ReferenceError('Dispatch tokens not provided')
    }

    if (arguments.length === 1) {
      sources = Array.isArray(sources) ? sources : [sources]
    } else {
      sources = Array.prototype.slice.call(arguments)
    }

    let tokens = sources.map((source) => {
      return source.dispatchToken || source
    })

    this.dispatcher.waitFor(tokens)
  },

  exportPublicMethods(methods) {
    Object.keys(methods).forEach((methodName) => {
      if (typeof methods[methodName] !== 'function') {
        throw new TypeError('exportPublicMethods expects a function')
      }

      this[Sym.PUBLIC_METHODS][methodName] = methods[methodName]
    })
  },

  emitChange() {
    this.getInstance().emitChange()
  }
}

const StoreMixinListeners = {
  on(lifecycleEvent, handler) {
    this[Sym.LIFECYCLE][lifecycleEvent] = handler.bind(this)
  },

  bindAction(symbol, handler) {
    if (!symbol) {
      throw new ReferenceError('Invalid action reference passed in')
    }
    if (typeof handler !== 'function') {
      throw new TypeError('bindAction expects a function')
    }

    if (handler.length > 1) {
      throw new TypeError(
        `Action handler in store ${this._storeName} for ` +
        `${(symbol[Sym.ACTION_KEY] || symbol).toString()} was defined with ` +
        `two parameters. Only a single parameter is passed through the ` +
        `dispatcher, did you mean to pass in an Object instead?`
      )
    }

    // You can pass in the constant or the function itself
    const key = symbol[Sym.ACTION_KEY] ? symbol[Sym.ACTION_KEY] : symbol
    this[Sym.LISTENERS][key] = handler.bind(this)
    this[Sym.ALL_LISTENERS].push(Symbol.keyFor(key))
  },

  bindActions(actions) {
    Object.keys(actions).forEach((action) => {
      const symbol = actions[action]
      const matchFirstCharacter = /./
      const assumedEventHandler = action.replace(matchFirstCharacter, (x) => {
        return `on${x[0].toUpperCase()}`
      })
      let handler = null

      if (this[action] && this[assumedEventHandler]) {
        // If you have both action and onAction
        throw new ReferenceError(
          `You have multiple action handlers bound to an action: ` +
          `${action} and ${assumedEventHandler}`
        )
      } else if (this[action]) {
        // action
        handler = this[action]
      } else if (this[assumedEventHandler]) {
        // onAction
        handler = this[assumedEventHandler]
      }

      if (handler) {
        this.bindAction(symbol, handler)
      }
    })
  },

  bindListeners(obj) {
    Object.keys(obj).forEach((methodName) => {
      const symbol = obj[methodName]
      const listener = this[methodName]

      if (!listener) {
        throw new ReferenceError(
          `${methodName} defined but does not exist in ${this._storeName}`
        )
      }

      if (Array.isArray(symbol)) {
        symbol.forEach((action) => {
          this.bindAction(action, listener)
        })
      } else {
        this.bindAction(symbol, listener)
      }
    })
  }
}
