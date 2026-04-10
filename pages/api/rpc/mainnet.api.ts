import {
  createRpcProxyHandler,
  rpcProxyRouteConfig,
} from '@utils/rpcProxyHandler'

export const config = rpcProxyRouteConfig

export default createRpcProxyHandler('RPC_MAINNET_PRIMARY', 'RPC_MAINNET_BACKUP')
