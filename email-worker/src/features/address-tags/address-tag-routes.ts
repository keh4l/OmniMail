import type { Hono } from 'hono'
import type { AppContext } from '../../app/context'
import {
  batchAddressTags,
  deleteAddressTag,
  listAddressTags,
  renameAddressTag,
  replaceAddressTags,
} from './address-tag-api'

export function registerAddressTagRoutes(app: Hono<AppContext>): void {
  app.get('/api/address-tags', (context) => listAddressTags(context.env, context.get('user')))
  app.post('/api/address-tags/batch', (context) => (
    batchAddressTags(context.env, context.get('user'), context.req.raw)
  ))
  app.patch('/api/address-tags/tags/:tag', (context) => (
    renameAddressTag(context.env, context.get('user'), context.req.param('tag'), context.req.raw)
  ))
  app.delete('/api/address-tags/tags/:tag', (context) => (
    deleteAddressTag(context.env, context.get('user'), context.req.param('tag'))
  ))
  app.put('/api/address-tags/:address', (context) => (
    replaceAddressTags(context.env, context.get('user'), context.req.param('address'), context.req.raw)
  ))
}
