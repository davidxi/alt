import Symbol from 'es-symbol'

import {
  ACTION_HANDLER,
  ACTION_KEY,
  ACTIONS_REGISTRY,
  ACTION_UID
} from './symbols/symbols'
import { uid } from './utils/AltUtils'

class AltAction {
  constructor(alt, name, action, actions) {
    this[ACTION_UID] = name
    this[ACTION_HANDLER] = action.bind(this)
    this.actions = actions
    this.alt = alt
  }

  dispatch(data) {
    this.alt.dispatch(this[ACTION_UID], data)
  }
}

export default function makeAction(alt, namespace, name, implementation, obj) {
  // make sure each Symbol is unique
  const actionId = uid(alt[ACTIONS_REGISTRY], `${namespace}.${name}`)
  alt[ACTIONS_REGISTRY][actionId] = 1
  const actionSymbol = Symbol.for(`alt/${actionId}`)

  // Wrap the action so we can provide a dispatch method
  const newAction = new AltAction(alt, actionSymbol, implementation, obj)

  // the action itself
  const action = newAction[ACTION_HANDLER]
  action.defer = (...args) => {
    setTimeout(() => {
      newAction[ACTION_HANDLER].apply(null, args)
    })
  }
  action[ACTION_KEY] = actionSymbol

  // ensure each reference is unique in the namespace
  const container = alt.actions[namespace]
  const id = uid(container, name)
  container[id] = action

  return action
}
