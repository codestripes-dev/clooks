import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { log, root } from './channel'
log('native-effect')
appendFileSync(join(root(), 'project', 'effect.txt'), 'native-effect\n')
