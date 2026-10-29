# Plantilla Clvj

Plantilla Angular y Capacitor adaptable y reutilizable, basada en la carcasa retro metálica de CaleVRije. Incluye tornillos decorativos, navegación entre secciones y una acción de ejemplo.

## Uso

Instala dependencias y arranca el servidor Angular:

```sh
npm install
npm start
```

Para compilar y sincronizar con Capacitor:

```sh
npm run build
npx cap add android   # una sola vez, si necesitas Android
npx cap sync android
```

Para iOS, ejecuta `npx cap add ios` en macOS. Cambia primero `appId` y `appName` en `capacitor.config.ts` por los valores de tu aplicación.

## Personalización

- **Nombre, versión y pantallas:** edita las propiedades y el arreglo `sections` en `src/app/app.component.ts`.
- **Acciones de cada pantalla:** adapta `runExampleAction()` y el contenido de `src/app/app.component.html`.
- **Colores globales:** cambia las variables CSS de `:root` en `src/styles.css`.
- **Estilo de la carcasa y componentes:** modifica `src/app/app.component.css`.
- **Marca:** sustituye `APP` por el logotipo de tu aplicación en `src/app/app.component.html`.
- **Salida de compilación:** Angular genera `dist/plantilla-clvj/browser`, configurada como `webDir` de Capacitor.

Cada aplicación nueva puede comenzar copiando esta carpeta y modificando su configuración, contenido y funciones.
