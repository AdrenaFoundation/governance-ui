import {
  createRpcProxyHandler,
  rpcProxyRouteConfig,
} from '@utils/rpcProxyHandler'

export const config = rpcProxyRouteConfig

export default createRpcProxyHandler('RPC_DEVNET_PRIMARY', 'RPC_DEVNET_BACKUP')
