import { Component } from '@angular/core';

@Component({
  selector: 'app-data-section',
  standalone: true,
  template: `<h2>Datos de la aplicación</h2><p>Ejemplo de una sección para contenido, listados, ajustes o información.</p><article class="info-card"><h3>Contenido de ejemplo</h3><p>La navegación cambia de pantalla sin recargar la aplicación.</p></article>`,
  styles: [':host{display:block;color:#142754}h2,h3{color:#142754;text-shadow:1px 1px #a5edff}p{line-height:1.5}.info-card{margin-bottom:13px;padding:16px;border:2px solid #142754;background:linear-gradient(145deg, #bcecff, #6ac9ef);;box-shadow:inset 0 0 0 2px #e9fbff}']
})
export class DataSectionComponent {}
