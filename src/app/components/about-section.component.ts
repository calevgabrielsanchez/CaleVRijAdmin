import { Component } from '@angular/core';

@Component({
  selector: 'app-about-section',
  standalone: true,
  template: `<h2>Acerca de esta plantilla</h2><p>Plantilla Angular y Capacitor con carcasa retro metálica.</p><article class="hero-card"><span class="card-label">ESTILO HOMOLOGADO</span><h3>CaleVRijAdmin</h3><p>Conserva la estructura visual y personaliza colores, nombre, secciones y funciones.</p></article>`,
  styles: [':host{display:block;color:#142754}h2,h3{color:#142754;text-shadow:1px 1px #a5edff}p{line-height:1.5}.hero-card{margin-bottom:13px;padding:16px;border:2px solid #142754;background:linear-gradient(145deg,#ffe55b,#f29a43);box-shadow:inset 0 0 0 2px #fff5a4}.card-label{display:block;margin-bottom:8px;color:#d52b72;font-size:9px;font-weight:900;letter-spacing:.12em}']
})
export class AboutSectionComponent {}
