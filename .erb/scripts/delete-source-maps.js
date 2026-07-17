import fs from 'fs'
import path from 'path'
import { rimrafSync } from 'rimraf'
import webpackPaths from '../configs/webpack.paths'

export default function deleteSourceMaps() {
    if (fs.existsSync(webpackPaths.distPath)) {
        const sourceMapGlob = path.join(webpackPaths.distPath, '**', '*.map').split(path.sep).join(path.posix.sep)
        rimrafSync(sourceMapGlob, {
            glob: true,
        })
    }
}
