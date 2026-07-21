import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sharedRoot = path.resolve(__dirname, '../shared')

/** shared 源码按 NodeNext 写 `.js` import，但 Vite 必须读 `.ts`，不能读 tsc 输出的 CJS `.js` */
function preferSharedTypescript(): Plugin {
  return {
    name: 'prefer-shared-typescript',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.js')) return null

      const normalizedImporter = importer.replace(/\\/g, '/')
      const normalizedSource = source.replace(/\\/g, '/')
      const inShared =
        normalizedImporter.includes('/shared/') ||
        normalizedSource.startsWith('@shared/')

      if (!inShared) return null

      let tsPath: string | undefined

      if (normalizedSource.startsWith('@shared/')) {
        const relative = normalizedSource
          .slice('@shared/'.length)
          .replace(/\.js$/, '.ts')
        tsPath = path.join(sharedRoot, relative)
      } else if (source.startsWith('.')) {
        tsPath = path.resolve(
          path.dirname(importer),
          source.replace(/\.js$/, '.ts'),
        )
      }

      if (tsPath && fs.existsSync(tsPath)) return tsPath
      return null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [preferSharedTypescript(), react(), tailwindcss()],
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': sharedRoot,
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
