import localforage from 'localforage'

export const store = localforage.createInstance({ name: 'chatboxkeypair' })
