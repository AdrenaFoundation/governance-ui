import { createRpcProxyHandler } from '@utils/rpcProxyHandler'

// Must be an inline literal — Next.js statically analyzes the `config`
// export and does not follow imports. Keep in sync with the mainnet route.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export default createRpcProxyHandler('RPC_DEVNET_PRIMARY', 'RPC_DEVNET_BACKUP')
