# 🚀 Deploy a Netlify - Guía Rápida

## Prerequisitos
- GitHub repo con rama `demo-netlify`
- Cuenta en Netlify (gratis)
- Archivo `public/index.html` ✅
- Webpack config listo ✅

## Paso 1: Preparar repo

```bash
# Ya hiciste esto, pero confirma:
git checkout demo-netlify
git status
# Deberías ver:
# - src/services/ApiService.js (modificado)
# - src/index.js (modificado)
# - public/index.html (nuevo)
# - DEMO_MODE.md (nuevo)
# - .env.example (nuevo)
```

## Paso 2: Commit y push

```bash
git add .
git commit -m "feat: ApiService dual mode (demo + wordpress) + Netlify config"
git push origin demo-netlify
```

## Paso 3: Conectar Netlify a GitHub

1. Ve a https://app.netlify.com/
2. Haz login (o sign up gratis)
3. Click "New site from Git"
4. Selecciona GitHub
5. Busca tu repo: `VitokoMP/TicketFlow-QR-`

## Paso 4: Configurar build

En Netlify verás:
- **Repository**: VitokoMP/TicketFlow-QR-
- **Branch to deploy**: `demo-netlify`
- **Build command**: `npm run build`
- **Publish directory**: `dist` (o donde webpack output bundle)

⚠️ **Importante**: Confirma dónde webpack pone el output.

Ver en `webpack.config.js`:
```javascript
output: {
  path: path.resolve(__dirname, 'dist'),  // ← Aquí
  filename: 'bundle.js'
}
```

Si está en otro lugar, cámbialo en Netlify.

## Paso 5: Variables de entorno (Opcional)

En Netlify → Build & Deploy → Environment:

```
DEMO_MODE=true
NODE_ENV=production
```

(Si no lo pones, usa `?demo=true` en la URL)

## Paso 6: Deploy

Click "Deploy site"

Netlify va a:
1. Clonar tu repo
2. Instalar dependencias (`npm install`)
3. Buildear (`npm run build`)
4. Subir `/dist` a servidores

Espera 1-2 minutos.

## Resultado

Obtendrás una URL como:
```
https://ticket-flow-qr-demo.netlify.app
```

O en DEMO mode:
```
https://ticket-flow-qr-demo.netlify.app/?demo=true
```

## ✅ Checklist pre-deploy

- [ ] Rama `demo-netlify` con commits
- [ ] `public/index.html` existe
- [ ] `webpack.config.js` apunta a carpeta correcta
- [ ] `npm run build` funciona localmente (opcional pero recomendado)
- [ ] No hay errores en console

## 🔍 Verificar después de deploy

1. Abre URL de Netlify
2. Abre consola (F12)
3. Busca: `✨ Ticket Flow iniciado en modo`
4. Ejecuta: `__getTicketFlowStatus()`

Si todo funciona → ✅ Demo lista

## 🎬 Para el video

URL a usar:
```
https://tu-site.netlify.app/?demo=true
```

Grabá con OBS:
- Panel scanner
- Panel validación (✅/❌)
- Panel contador
- 60-90 segundos total

---

**Tiempo total**: ~15 minutos (la mayoría esperando a Netlify)

---

## 📞 Si algo falla

### Error: "Cannot find module"
- Verifica que todas las dependencias en `package.json` están instaladas
- Intenta: `npm install` localmente

### Error: "dist not found"
- Confirma la ruta en `webpack.config.js` → `output.path`
- Cambia en Netlify → Build & Deploy → Publish directory

### DEMO mode no se activa
- Usa URL: `?demo=true`
- O en Netlify variables: `DEMO_MODE=true`
- Abre console y verifica logs

