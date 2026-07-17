import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
// Archivo MUST come from wdth.css: the default index.css is weight-only and
// silently no-ops font-stretch (the "Expanded" display look, ui-spec §2).
// Plex is imported latin-only to keep the bundle lean (unicode-range gates
// runtime loading regardless, but this trims emitted files).
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import {AppShell} from './app/AppShell';
import './app/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>
);
