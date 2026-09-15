import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { record } from './records'
const root = process.env.APPROVAL_ROOT!
record(root, 'native-effect')
appendFileSync(join(root, 'project/effect.txt'), 'native-effect\n')
