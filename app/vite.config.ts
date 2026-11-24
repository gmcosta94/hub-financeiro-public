import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Torna o site instalável no iPhone/iPad (Compartilhar → Adicionar à Tela de Início).
    // O service worker guarda só os arquivos do app; os dados vêm sempre do banco.
    // A troca de versão é feita pelo app (src/lib/atualizacao.ts), quando nada está
    // sendo editado: por isso "prompt" e não "autoUpdate", que recarrega na hora.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Hub Financeiro',
        short_name: 'Hub',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#f1f3f5',
        theme_color: '#0f766e',
        icons: [
          { src: 'icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
