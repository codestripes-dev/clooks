import { log } from './channel'
const input = await Bun.stdin.json()
log('native-post', { input })
