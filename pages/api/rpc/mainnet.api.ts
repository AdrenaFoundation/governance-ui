import { createRpcProxyHandler } from '@utils/rpcProxyHandler'

// Must be an inline literal — Next.js statically analyzes the `config`
// export and does not follow imports. Keep in sync with the devnet route.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export default createRpcProxyHandler(
  'RPC_MAINNET_PRIMARY',
  'RPC_MAINNET_BACKUP',
  undefined,
  'RPC_MAINNET_BACKUP_API_KEY',
)
