import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},server:{host:'127.0.0.1',port:5173,proxy:{'/api':'http://127.0.0.1:3000','/uploads':'http://127.0.0.1:3000'}},build:{outDir:'dist',emptyOutDir:true}});
