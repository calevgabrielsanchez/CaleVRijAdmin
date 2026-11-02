import { Component, Input, inject, signal, ChangeDetectorRef, ElementRef, ViewChild } from '@angular/core';
import {
  faSave, faFileHalfDashed, faGlobe, faBook, faEarthAmericas, faScroll, faImage,
  faCircleInfo, faSquarePlus, faBaby, faDragon, faMeteor, faSkullCrossbones, faTrashCan,
  faPenFancy,
  faDownload, faUpload, faRefresh, faBrain, faBug, faUserSecret, faShrimp, faArrowsSpin,
  faEye, faFolderOpen,
  faBookOpen, faEraser, faTextHeight, faBurger, faSquareXmark
} from '@fortawesome/free-solid-svg-icons';
import { TextPlusComponent } from '../text-plus.component/text-plus.component';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { FormGroup, FormControl, ReactiveFormsModule } from '@angular/forms'
import { CommonModule } from '@angular/common';
import { ProjectDirectoryHandle } from '../view-content.component/project-library-manager.component';
import { CreatividadStorageService } from './creatividad-storage.service';
import { Creatividad, CreatividadData, Dibujo, Memoria } from './creatividad.models';

interface EjercicioCreatividad {
  id: number;
  nombre: string;
  descripcion: string;
}

interface ArquetipoCreatividad {
  id: number;
  nombre: string;
  descripcion: string;
  ejemplos?: string;
  frase_tipica?: string;
  categoria?: string;
}

@Component({
  selector: 'app-creatividad',
  standalone: true,
  imports: [TextPlusComponent, FaIconComponent, CommonModule, ReactiveFormsModule],
  templateUrl: './creatividad.component.html',
  styleUrl: './creatividad.component.css',
})
export class CreatividadComponent {

  camposSemanticos: FormGroup;
  controlesTienda: FormGroup;
  ejercicio = [];
  descripcionEjercicioSeleccionado: string = "";
  descripcionArquetipoSeleccionado: string = "";

  private readonly storage = inject(CreatividadStorageService);
  private readonly cdr = inject(ChangeDetectorRef);
  private selectedLibraryRoot: ProjectDirectoryHandle | null = null;
  private loadGeneration = 0;
  storageMessage = 'Selecciona una biblioteca para guardar los datos de Creatividad.';
  savedCreatividades: Creatividad[] = [];
  savedMemorias: Memoria[] = [];
  savedDibujos: Dibujo[] = [];
  memoria = {} as Memoria;
  dibujoModel = {} as Dibujo;
  creatividadModel = {} as Creatividad;

  faSave = faSave;
  faFileHalfDashed = faFileHalfDashed;
  faGlobe = faGlobe;
  faBook = faBook;
  faEarthAmericas = faEarthAmericas;
  faScroll = faScroll;
  faImage = faImage;
  faCircleInfo = faCircleInfo;
  faSquarePlus = faSquarePlus;
  faBaby = faBaby;
  faDragon = faDragon;
  faMeteor = faMeteor;
  faSkullCrossbones = faSkullCrossbones;
  faTrashCan = faTrashCan;
  faPenFancy = faPenFancy;
  faDownload = faDownload;
  faUpload = faUpload;
  faRefresh = faRefresh;
  faBrain = faBrain;
  faBug = faBug;
  faUserSecret = faUserSecret;
  faShrimp = faShrimp;
  faArrowsSpin = faArrowsSpin;
  faEye = faEye
  faBookOpen = faBookOpen;
  faEraser = faEraser;
  faTextHeight = faTextHeight;
  faBurger = faBurger;
  faSquareXmark = faSquareXmark;

  faFolderOpen = faFolderOpen;

  @Input()
  set libraryRoot(root: ProjectDirectoryHandle | null) {
    this.selectedLibraryRoot = root;
    if (root) void this.loadFromLibrary(root);
    else this.storageMessage = 'Selecciona una biblioteca para guardar los datos de Creatividad.';
  }
  mostrarTextPlus = signal(false);
  textoAEditar: string = "";
  mostrarMenuModal: boolean = false;

  palabras = signal<any[]>([]);
  datosConvertidos: any[] = [];
  catalogMessage = '';

  private readonly wordBank: Record<string, string[]> = {
    animales: ['zorro', 'ballena', 'colibrí', 'tortuga', 'lobo', 'mariposa', 'pulpo'],
    adjetivos: ['luminoso', 'antiguo', 'valiente', 'silencioso', 'curioso', 'frágil', 'infinito'],
    hombre: ['viajero', 'artesano', 'astrónomo', 'guardabosques', 'navegante'],
    lugares: ['estación', 'bosque', 'mercado', 'isla', 'biblioteca', 'desierto'],
    mujer: ['pintora', 'inventora', 'exploradora', 'jardinera', 'música'],
    oficios: ['relojero', 'panadera', 'cartógrafo', 'boticaria', 'farero'],
    pronombres: ['alguien', 'nosotros', 'ella', 'ellos', 'cualquiera'],
    sustantivos: ['reloj', 'puente', 'semilla', 'ventana', 'mapa', 'tormenta'],
    transporte: ['tranvía', 'bicicleta', 'barco', 'dirigible', 'tren'],
    verbos: ['imaginar', 'descubrir', 'construir', 'recordar', 'volar', 'transformar'],
    varias: ['amanecer', 'secreto', 'eco', 'destino', 'azar']
  };

  ejercicios = signal<any[]>([]);
  arquetipos = signal<any[]>([]);

  historia: string[] = [];

  inputId: number = 0;

  resultadoTienda: number = 0;
  operacionResultado: string = '';
  controlTextPlus: string = "";

  creatividad: boolean = true;
  memoriaB: boolean = false;
  matematicas: boolean = false;
  dibujo: boolean = false;
  //=========================================================
  //                FUNCIONES
  //=========================================================

  constructor() {
    this.camposSemanticos = new FormGroup({
      animales: new FormControl(false),
      adjetivos: new FormControl(false),
      hombre: new FormControl(false),
      lugares: new FormControl(false),
      mujer: new FormControl(false),
      oficios: new FormControl(false),
      pronombres: new FormControl(false),
      sustantivos: new FormControl(false),
      transporte: new FormControl(false),
      verbos: new FormControl(false),
      varias: new FormControl(false),
      todas: new FormControl(false)
    });

    this.controlesTienda = new FormGroup({
      decimal: new FormControl(false),
      tienda: new FormControl(false),
      suma: new FormControl(true),
      resta: new FormControl(false),
      multiplicacion: new FormControl(false),
      divicion: new FormControl(false),
      juegoSeleccionada: new FormControl('operaciones')
    });

  }

  ngOnInit() {
    void this.cargarCatalogos();
    this.crearTablaMemoria();
    this.historia = Array(20).fill('');
  }

  private async cargarCatalogos(): Promise<void> {
    try {
      const ejerciciosUrl = new URL('json/ejerciciosCreatividad.json', document.baseURI);
      const arquetiposUrl = new URL('json/arquetipos.json', document.baseURI);
      const [ejerciciosResponse, arquetiposResponse] = await Promise.all([
        fetch(ejerciciosUrl),
        fetch(arquetiposUrl)
      ]);

      if (!ejerciciosResponse.ok) {
        throw new Error(`No se pudo cargar ejerciciosCreatividad.json (${ejerciciosResponse.status}).`);
      }
      if (!arquetiposResponse.ok) {
        throw new Error(`No se pudo cargar arquetipos.json (${arquetiposResponse.status}).`);
      }

      const [ejercicios, arquetipos]: [unknown, unknown] = await Promise.all([
        ejerciciosResponse.json(),
        arquetiposResponse.json()
      ]);

      if (!Array.isArray(ejercicios) || !ejercicios.every(this.esEjercicioCreatividad)) {
        throw new Error('El formato de ejerciciosCreatividad.json no es válido.');
      }
      if (!Array.isArray(arquetipos) || !arquetipos.every(this.esArquetipoCreatividad)) {
        throw new Error('El formato de arquetipos.json no es válido.');
      }

      this.ejercicios.set(ejercicios);
      this.arquetipos.set(arquetipos);
      this.catalogMessage = '';
    } catch (error) {
      console.error('No se pudieron cargar los catálogos de Creatividad.', error);
      this.catalogMessage = error instanceof Error
        ? error.message
        : 'No se pudieron cargar los ejercicios y arquetipos.';
    }
  }

  private esEjercicioCreatividad(value: unknown): value is EjercicioCreatividad {
    if (typeof value !== 'object' || value === null) return false;
    const item = value as Record<string, unknown>;
    return typeof item['id'] === 'number'
      && typeof item['nombre'] === 'string'
      && typeof item['descripcion'] === 'string';
  }

  private esArquetipoCreatividad(value: unknown): value is ArquetipoCreatividad {
    if (typeof value !== 'object' || value === null) return false;
    const item = value as Record<string, unknown>;
    return typeof item['id'] === 'number'
      && typeof item['nombre'] === 'string'
      && typeof item['descripcion'] === 'string';
  }

  private async loadFromLibrary(root: ProjectDirectoryHandle): Promise<void> {
    const generation = ++this.loadGeneration;
    this.storageMessage = 'Cargando los datos de Creatividad…';
    try {
      const data = await this.storage.load(root);
      if (generation !== this.loadGeneration || root !== this.selectedLibraryRoot) return;
      this.savedCreatividades = data.creatividad;
      this.savedMemorias = data.memorias;
      this.savedDibujos = data.dibujos;
      this.creatividadModel = this.savedCreatividades.at(-1) ?? ({} as Creatividad);
      this.memoria = this.savedMemorias.at(-1) ?? ({} as Memoria);
      this.dibujoModel = this.savedDibujos.at(-1) ?? ({} as Dibujo);
      this.storageMessage = 'Datos cargados desde la carpeta Creatividad de la biblioteca.';
    } catch {
      if (generation === this.loadGeneration) this.storageMessage = 'No se pudieron cargar los datos de Creatividad.';
    }
  }

  async cargarDatosLocales(): Promise<void> {
    if (!this.selectedLibraryRoot) { this.storageMessage = 'Selecciona una biblioteca para cargar sus datos.'; return; }
    await this.loadFromLibrary(this.selectedLibraryRoot);
  }

  async onGuardarCambios(): Promise<void> {
    if (!this.selectedLibraryRoot) { this.storageMessage = 'Selecciona una biblioteca antes de guardar.'; return; }
    const data: CreatividadData = {
      creatividad: this.savedCreatividades,
      memorias: this.savedMemorias,
      dibujos: this.savedDibujos
    };
    try {
      await this.storage.save(this.selectedLibraryRoot, data);
      this.storageMessage = 'Datos guardados en la carpeta Creatividad de la biblioteca.';
    } catch {
      this.storageMessage = 'No se pudieron guardar los datos. Comprueba los permisos de escritura.';
    }
  }

  cerrar() {
    this.closeTextPlus(this.textoAEditar);
  }

  closeTextPlus(resolvedValue: string) {
    this.mostrarTextPlus.set(false);
    /* if (this.textPlusPromiseResolver) {
       this.textPlusPromiseResolver(resolvedValue);
       this.textPlusPromiseResolver = null;
     }*/
  }

  
  aceptar() {
    switch (this.controlTextPlus) {
      case 'memoria':
        this.historia[this.inputId - 1] = this.textoAEditar;
        console.log(this.textoAEditar)
        this.mostrarTextPlus.set(false);
        break;
      case 'dibujo':
        this.dibujoModel.historia = this.textoAEditar;
        console.log(this.textoAEditar)
        this.mostrarTextPlus.set(false);
        break;
       case 'creatividad':
        this.creatividadModel.desarrollo = this.textoAEditar;
        console.log(this.textoAEditar)
        this.mostrarTextPlus.set(false);
        break; 
    }

  }

  abrirEditarText() {
    // this.textoAEditar = this.textareaSeleccionada()?.value || '';
    this.mostrarTextPlus.set(true);
    this.cdr.detectChanges();
  }

  mostrarMenu() {
    this.mostrarMenuModal = !this.mostrarMenuModal;
  }

  onClickCaleVRije() {
    window.location.href = '/';
  }

  onClickMente() {
    this.mostrarMenuModal = false;
  }
  //==========================================================
  //                       Ejercicios Creatividad
  //=========================================================
  onGenerarPalabras() {
    const requested = Number.parseInt(prompt('¿Cuántas palabras quieres generar?', '5') ?? '5', 10);
    const count = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 100) : 5;
    const selected = Object.entries(this.camposSemanticos.value)
      .filter(([key, checked]) => checked && key !== 'todas')
      .map(([key]) => key);
    if (this.camposSemanticos.get('todas')?.value) selected.push(...Object.keys(this.wordBank));
    const categories = [...new Set(selected)];
    if (!categories.length) { this.palabras.set([]); return; }
    this.palabras.set(categories.flatMap(category =>
      this.obtenerElementosAleatorios(this.wordBank[category] ?? [], count).map(palabra => ({ palabra, categoria: category }))
    ));
  }

  obtenerElementosAleatorios(datos: any[], n: number): any[] {
    // Hacemos una copia del arreglo original para no mutarlo directamente
    const copia = [...datos];

    // Algoritmo de mezcla de Fisher-Yates
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }

    // Devolvemos la cantidad 'n' solicitada (limitada al tamaño total del arreglo)
    return copia.slice(0, n);
  }

  onSelectEjercicio(event: Event) {
    const idSeleccionado = Number((event.target as HTMLSelectElement).value);
    const ejercicioSeleccionado = this.ejercicios().find(
      item => item.id === idSeleccionado
    );
    this.descripcionEjercicioSeleccionado = ejercicioSeleccionado?.descripcion ?? '';
  }

  onEjercicioAleatorio() {
    const ejercicios = this.ejercicios();
    if (!ejercicios.length) return;

    const ejercicioAleatorio = ejercicios[Math.floor(Math.random() * ejercicios.length)];
    this.descripcionEjercicioSeleccionado = ejercicioAleatorio.descripcion;

    const selectElement = document.getElementById('ejercicio') as HTMLSelectElement | null;
    if (selectElement) selectElement.value = ejercicioAleatorio.id.toString();
  }

  onSelectArquetipo(event: Event) {
    const idSeleccionado = Number((event.target as HTMLSelectElement).value);
    const arquetipoSeleccionado = this.arquetipos().find(
      item => item.id === idSeleccionado
    );
    if (!arquetipoSeleccionado) { this.descripcionArquetipoSeleccionado = ''; return; }
    this.descripcionArquetipoSeleccionado = `${arquetipoSeleccionado.nombre}${arquetipoSeleccionado.categoria ? ` · ${arquetipoSeleccionado.categoria}` : ''}\n` +
      `${arquetipoSeleccionado.descripcion}\nFrase: ${arquetipoSeleccionado.frase_tipica ?? 'No especificada'}\n` +
      `Ejemplos: ${arquetipoSeleccionado.ejemplos ?? 'No especificados'}`;
  }

  onArquetipoAleatorio() {
    if (!this.arquetipos().length) return;
    //generar un número aleatorio entre 0 y el tamaño del arreglo de arquetipos
    const indiceAleatorio = Math.floor(Math.random() * this.arquetipos().length);
    const arquetipoAleatorio = this.arquetipos()[indiceAleatorio];
    this.descripcionArquetipoSeleccionado = `${arquetipoAleatorio.nombre}${arquetipoAleatorio.categoria ? ` · ${arquetipoAleatorio.categoria}` : ''}\n` +
      `${arquetipoAleatorio.descripcion}\nFrase: ${arquetipoAleatorio.frase_tipica ?? 'No especificada'}\n` +
      `Ejemplos: ${arquetipoAleatorio.ejemplos ?? 'No especificados'}`;
    //seleccionar el arquetipo aleatorio en el select
    const selectElement = document.getElementById("arquetipo") as HTMLSelectElement;
    selectElement.value = arquetipoAleatorio.id.toString();
  }

  selectJuego(juego: string) {
    this.creatividad = false;
    this.memoriaB = false;
    this.matematicas = false;
    this.dibujo = false;
    switch (juego) {
      case 'creatividad':
        this.creatividad = true;
        break;
      case 'memoria':
        this.memoriaB = true;
        break;
      case 'matematicas':
        this.matematicas = true;
        break;
      case 'dibujo':
        this.dibujo = true;
        break;
    }
  }

  onEscribirEjercicioCreatividad() {
    this.controlTextPlus='creatividad';
    this.mostrarTextPlus.set(true);
    let ejercicioTextInput = document.getElementById("ejercicio") as HTMLSelectElement;
    let titulo = ejercicioTextInput.options[ejercicioTextInput.selectedIndex].text;
    let arquetipoTextInput = document.getElementById("arquetipo") as HTMLSelectElement;
    let arquetipo = arquetipoTextInput.options[arquetipoTextInput.selectedIndex].text;
    let palabras = this.palabras().map(p => p.palabra).join("\n");
    this.textoAEditar = "#" + titulo + "\n" + this.descripcionEjercicioSeleccionado + "\n" +
      "#" + arquetipo + "\n" + this.descripcionArquetipoSeleccionado + "\n" +
      "#Palabras" + "\n" + palabras + "\n ----------------------Empieza----------------------";
    console.log(this.textoAEditar);
  }

  async onGuardarCreatividad() {
    const nombre = prompt('Ponle un nombre a esta creación:')?.trim();

    if (!nombre) {
      console.error('❌ Se canceló el guardado: no se proporcionó un nombre.');
      return;
    }

    this.creatividadModel = {
      id: nombre + '_' + this.generarAleatorioId(),
      nombre,
      desarrollo: this.textoAEditar,
      updatedAt: Date.now(),
      _deleted: false
    };

    this.savedCreatividades = [...this.savedCreatividades.filter(item => item.id !== this.creatividadModel.id), this.creatividadModel];
    await this.onGuardarCambios();
  }

  async onAbrirCreatividad() {
    const creaciones = this.savedCreatividades;

    if (creaciones.length === 0) {
      alert('No hay creaciones guardadas.');
      return;
    }

    const lista = creaciones.map((creacion, i) => `${i + 1}.- ${creacion.nombre}`).join('\n');
    const indice = prompt('¿Qué creación quieres abrir?\n\n' + lista + '\n\nEscribe el número:')?.trim();

    if (!indice) {
      return;
    }

    const numero = parseInt(indice, 10);
    if (isNaN(numero) || numero < 1 || numero > creaciones.length) {
      alert('Índice inválido.');
      return;
    }

    const seleccionada = creaciones[numero - 1];
    this.textoAEditar = seleccionada.desarrollo;
    this.abrirEditarText();

    console.log('📖 Creatividad abierta:', seleccionada);
  }

  //=============================================================
  //---------------------------Memoria-------------------------------
  //===============================================================
  tablaMemoria = signal<any[]>([]);
  crearTablaMemoria() {
    const emojis = ['🌱', '🌊', '⭐', '🪶', '🌙', '🔥', '🪨', '🌈', '🍃', '🧭', '🕯️', '🦋', '🌻', '☁️', '🐚', '🍂', '🔑', '🪐', '🌺', '🎈'];
    this.tablaMemoria.set(emojis.map((emogi, index) => ({ id: String(index + 1), key: `memoria-${index + 1}`, emogi, palabra: '' })));
  }
  ocultarPalabra($event: any) {
    const elemento = $event.currentTarget as HTMLElement;
    const id = elemento.getAttribute('data-id');

    console.log(id);
    const inputText = document.getElementById(id || '');

    if (inputText) {
      inputText.classList.toggle('oculto-text');
    }

  }

  alternarPalabra() {
    const vocabulary = Object.values(this.wordBank).flat();
    const words = this.obtenerElementosAleatorios(vocabulary, 20);
    this.historia = [];
    words.forEach((word, index) => {
      const input = document.getElementById(`text${index + 1}`) as HTMLInputElement | null;
      if (input) input.value = word;
      this.historia.push(word);
    });
  }

  ocultarTodasPalabra() {
    const inputs = document.querySelectorAll('.input-text');
    inputs.forEach((input, i) => {
      // (input as HTMLInputElement).value = palabrasAleatorias[i].todasPalabras;
      input.classList.toggle('oculto-text');
    });
  }

  escribirHistoria($event: any) {
    const elemento = $event.currentTarget as HTMLElement;
    const id = elemento.getAttribute('data-id');
    const numeroId = id?.substring(4, 5);
    this.inputId = parseInt(numeroId || '')
    const inputText = document.getElementById(id || '');
    if ((this.historia[this.inputId - 1] != (inputText as HTMLInputElement).value) && (this.historia[this.inputId - 1] != '')) {
      this.textoAEditar = this.historia[this.inputId - 1];
    } else {
      this.textoAEditar = (inputText as HTMLInputElement).value
    }
    this.controlTextPlus='memoria';
    this.mostrarTextPlus.set(true);
  }

  escribirTodaHistoria() {
    let texto = '';
    for (let i = 0; i < 20; i++) {
      texto = texto + '>----------------' + (i + 1) + '----------------<\n';
      texto = texto + this.historia[i] + "\n";
    }
    this.controlTextPlus='memoria';
    this.textoAEditar = texto;
    this.mostrarTextPlus.set(true);
  }

  async guardarMemoria() {
    const nombre = prompt('Ponle un nombre a esta memoria:')?.trim();

    if (!nombre) {
      console.error('❌ Se canceló el guardado: no se proporcionó un nombre.');
      return;
    }

    const aleatorio = this.generarAleatorioId();
    const memoria: Memoria = { id: nombre + '_' + aleatorio, updatedAt: Date.now(), _deleted: false };

    const palabras = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
      'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];

    palabras.forEach((nombreCampo, indice) => {
      const inputText = document.getElementById('text' + (indice + 1)) as HTMLInputElement;
      const palabra = inputText?.value ?? '';
      const descripcion = this.historia[indice] ?? '';

      memoria[nombreCampo + 'Palabra'] = palabra;
      memoria[nombreCampo + 'Descripcion'] = descripcion;
    });

    this.memoria = memoria;
    this.savedMemorias = [...this.savedMemorias, memoria];
    await this.onGuardarCambios();
  }

  async abrirMemoria() {
    const memorias = this.savedMemorias;

    if (memorias.length === 0) {
      alert('No hay memorias guardadas.');
      return;
    }

    const lista = memorias.map((memoria, i) => `${i + 1}.- ${memoria.id}`).join('\n');
    const indice = prompt('¿Qué memoria quieres abrir?\n\n' + lista + '\n\nEscribe el número:')?.trim();

    if (!indice) {
      return;
    }

    const numero = parseInt(indice, 10);
    if (isNaN(numero) || numero < 1 || numero > memorias.length) {
      alert('Índice inválido.');
      return;
    }

    const memoria = memorias[numero - 1];
    const palabras = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
      'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];

    palabras.forEach((nombreCampo, i) => {
      const inputText = document.getElementById('text' + (i + 1)) as HTMLInputElement;
      if (inputText) {
        inputText.value = (memoria as any)[nombreCampo + 'Palabra'] ?? '';
      }
      this.historia[i] = (memoria as any)[nombreCampo + 'Descripcion'] ?? '';
    });

    console.log('📖 Memoria abierta:', memoria);
  }
  //---------------------------------------------------dibujo ------------------------------

  // ============================================================
  // CANVAS
  // ============================================================

  @ViewChild('canvas')
  canvas?: ElementRef<HTMLCanvasElement>;

  ctx?: CanvasRenderingContext2D;

  isDrawing = false;


  // ============================================================
  // CARACTERES ALEATORIOS
  // ============================================================

  randomCharacter = '';

  characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!"#$%&/()=?¡¿*+{}-_.:,;<>|@';

  // ============================================================
  // OBTENER CANVAS
  // ============================================================

  getCanvasElement(): HTMLCanvasElement | null {

    /*
     * Primero intentamos utilizar @ViewChild si existe.
     */

    if (this.canvas?.nativeElement) {
      return this.canvas.nativeElement;
    }


    /*
     * Si @ViewChild todavía no está disponible,
     * buscamos el canvas por su clase.
     */

    const element = document.querySelector(
      'canvas.canvas-dibujo'
    );


    if (element instanceof HTMLCanvasElement) {
      return element;
    }


    console.error(
      'No se encontró el elemento canvas.'
    );

    return null;
  }


  // ============================================================
  // OBTENER CANVAS DESDE EL EVENTO
  // ============================================================

  getCanvasFromEvent(
    event: PointerEvent
  ): HTMLCanvasElement | null {

    const target = event.currentTarget;


    if (target instanceof HTMLCanvasElement) {
      return target;
    }


    return null;
  }


  // ============================================================
  // CONFIGURAR CANVAS
  // ============================================================

  configureCanvas(
    context: CanvasRenderingContext2D
  ): void {

    context.lineWidth = 5;

    context.lineCap = 'round';

    context.lineJoin = 'round';

    context.strokeStyle = '#000000';
  }


  // ============================================================
  // GENERAR CARÁCTER ALEATORIO
  // ============================================================

  generateRandomCharacter(): void {

    const index = Math.floor(
      Math.random() * this.characters.length
    );


    this.randomCharacter =
      this.characters[index];


    /*
     * Dibujamos el nuevo carácter.
     */

    this.drawCharacter();
  }


  // ============================================================
  // DIBUJAR CARÁCTER
  // ============================================================

  drawCharacter(): void {

    const canvas =
      this.getCanvasElement();


    if (!canvas) {
      console.error(
        'No se encontró el canvas para dibujar el carácter.'
      );

      return;
    }


    const context =
      canvas.getContext('2d');


    if (!context) {

      console.error(
        'No se pudo obtener el contexto 2D del canvas.'
      );

      return;
    }


    /*
     * Guardamos el contexto.
     */

    this.ctx = context;


    /*
     * Limpiar canvas.
     */

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );


    // ========================================================
    // CARÁCTER
    // ========================================================

    /*
     * Canvas:
     *
     * 500 x 800
     *
     * Área total:
     *
     * 400,000 px²
     *
     * El tamaño visual del carácter se aproxima
     * al 58% del área.
     */

    const fontSize = 450;


    context.save();


    context.font =
      `bold ${fontSize}px Arial`;


    context.textAlign =
      'center';


    context.textBaseline =
      'middle';


    context.fillStyle =
      '#000000';


    /*
     * Dibujar carácter exactamente
     * en el centro.
     */

    context.fillText(
      this.randomCharacter,
      canvas.width / 2,
      canvas.height / 2
    );


    context.restore();


    /*
     * Volver a configurar el pincel
     * para que el usuario pueda dibujar.
     */

    this.configureCanvas(context);
  }


  // ============================================================
  // COMENZAR DIBUJO
  // ============================================================

  startDrawing(
    event: PointerEvent
  ): void {

    event.preventDefault();


    /*
     * Obtenemos directamente el canvas
     * que recibió el evento.
     *
     * Esto evita el problema:
     *
     * this.canvas.nativeElement
     *
     * undefined.
     */

    const canvas =
      this.getCanvasFromEvent(event);


    if (!canvas) {

      console.error(
        'El evento no proviene de un canvas.'
      );

      return;
    }


    /*
     * Obtener contexto.
     */

    const context =
      canvas.getContext('2d');


    if (!context) {

      console.error(
        'No se pudo obtener el contexto 2D.'
      );

      return;
    }


    this.ctx =
      context;


    this.isDrawing =
      true;


    /*
     * Configuración del pincel.
     */

    this.configureCanvas(
      context
    );


    /*
     * Obtener posición del dedo
     * o mouse.
     */

    const position =
      this.getPointerPosition(
        event,
        canvas
      );


    /*
     * Comenzar trazo.
     */

    context.beginPath();


    context.moveTo(
      position.x,
      position.y
    );


    /*
     * Capturar el puntero.
     *
     * Esto mejora el dibujo cuando
     * el dedo/mouse sale momentáneamente
     * del canvas.
     */

    try {

      canvas.setPointerCapture(
        event.pointerId
      );

    } catch {

      // Algunos dispositivos pueden no soportarlo.
    }
  }


  // ============================================================
  // DIBUJAR
  // ============================================================

  draw(
    event: PointerEvent
  ): void {

    if (
      !this.isDrawing ||
      !this.ctx
    ) {

      return;
    }


    event.preventDefault();


    const canvas =
      this.getCanvasFromEvent(event);


    if (!canvas) {
      return;
    }


    const position =
      this.getPointerPosition(
        event,
        canvas
      );


    /*
     * Dibujar línea.
     */

    this.ctx.lineTo(
      position.x,
      position.y
    );


    this.ctx.stroke();
  }


  // ============================================================
  // FINALIZAR DIBUJO
  // ============================================================

  stopDrawing(
    event?: PointerEvent
  ): void {

    if (!this.isDrawing) {
      return;
    }


    this.isDrawing =
      false;


    /*
     * Cerrar el trazo solamente
     * si existe contexto.
     */

    if (this.ctx) {

      this.ctx.closePath();
    }


    /*
     * Liberar el puntero.
     */

    if (
      event &&
      event.currentTarget instanceof HTMLCanvasElement
    ) {

      const canvas =
        event.currentTarget;


      try {

        canvas.releasePointerCapture(
          event.pointerId
        );

      } catch {

        // El puntero puede ya estar liberado.
      }
    }
  }


  // ============================================================
  // POSICIÓN DEL PUNTERO
  // ============================================================

  getPointerPosition(
    event: PointerEvent,
    canvas: HTMLCanvasElement
  ): {
    x: number;
    y: number;
  } {

    const rect =
      canvas.getBoundingClientRect();


    /*
     * Escalado.
     *
     * Esto permite que funcione correctamente
     * aunque el canvas visualmente tenga
     * un tamaño diferente al interno.
     */

    const scaleX =
      canvas.width / rect.width;


    const scaleY =
      canvas.height / rect.height;


    return {

      x:
        (event.clientX - rect.left)
        * scaleX,

      y:
        (event.clientY - rect.top)
        * scaleY
    };
  }


  // ============================================================
  // LIMPIAR DIBUJO
  // ============================================================

  clearDrawing(): void {

    const canvas =
      this.getCanvasElement();


    if (!canvas) {
      return;
    }


    const context =
      canvas.getContext('2d');


    if (!context) {
      return;
    }


    /*
     * Limpiar todo.
     */

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );


    /*
     * Volver a dibujar el carácter.
     */

    if (this.randomCharacter) {

      context.save();


      context.font =
        'bold 450px Arial';


      context.textAlign =
        'center';


      context.textBaseline =
        'middle';


      context.fillStyle =
        '#000000';


      context.fillText(
        this.randomCharacter,
        canvas.width / 2,
        canvas.height / 2
      );


      context.restore();


      /*
       * Restaurar configuración del pincel.
       */

      this.configureCanvas(
        context
      );
    }
  }


  // ============================================================
  // NUEVO CARÁCTER
  // ============================================================

  nuevoCaracter(): void {

    this.generateRandomCharacter();
  }

  // ============================================================
  // GUARDAR / ABRIR DIBUJO
  // ============================================================

  async guardarDibujo() {
    const canvas = this.getCanvasElement();
    if (!canvas) {
      console.error('No se encontró el canvas para guardar.');
      return;
    }
    const nombre = prompt('Ponle un nombre a este dibujo:')?.trim();

    if (!nombre) {
      console.error('❌ Se canceló el guardado: no se proporcionó un nombre.');
      return;
    }

    const aleatorio = this.generarAleatorioId();

    this.dibujoModel.id = nombre + '_' + aleatorio;
    this.dibujoModel.nombre = nombre;
    this.dibujoModel.dibujo = canvas.toDataURL('image/png');
    this.dibujoModel.updatedAt = Date.now();
    this.dibujoModel._deleted = false;

    this.savedDibujos = [...this.savedDibujos.filter(dibujo => dibujo.id !== this.dibujoModel.id), this.dibujoModel];
    await this.onGuardarCambios();
  }

  async abrirDibujo() {
    const dibujos = this.savedDibujos;

    if (dibujos.length === 0) {
      alert('No hay dibujos guardados.');
      return;
    }

    const lista = dibujos.map((dibujo, i) => `${i + 1}.- ${dibujo.id}`).join('\n');
    const indice = prompt('¿Qué dibujo quieres abrir?\n\n' + lista + '\n\nEscribe el número:')?.trim();

    if (!indice) {
      return;
    }

    const numero = parseInt(indice, 10);
    if (isNaN(numero) || numero < 1 || numero > dibujos.length) {
      alert('Índice inválido.');
      return;
    }

    const seleccionado = dibujos[numero - 1];
    this.dibujoModel = { ...seleccionado };

    const canvas = this.getCanvasElement();
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const imagen = new Image();
    imagen.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imagen, 0, 0, canvas.width, canvas.height);
      this.configureCanvas(ctx);
    };
    imagen.src = seleccionado.dibujo;

    console.log('📖 Dibujo abierto:', seleccionado);
  }

  // ============================================================
  // MATEMATICAS
  // ============================================================

  generarJuegMatematicTienda() {
    const decimal = this.controlesTienda.get('decimal')?.value;
    const tienda = this.controlesTienda.get('tienda')?.value;
    const suma = this.controlesTienda.get('suma')?.value;
    const resta = this.controlesTienda.get('resta')?.value;
    const multiplicacion = this.controlesTienda.get('multiplicacion')?.value;
    const divicion = this.controlesTienda.get('divicion')?.value;

    let operaciones = ['+', '-', '*', '/'];
    let aleatorioOperaciones = []

    if (suma) { aleatorioOperaciones.push(0); }
    if (resta) aleatorioOperaciones.push(1);
    if (multiplicacion) aleatorioOperaciones.push(2);
    if (divicion) aleatorioOperaciones.push(3);
    const indiceAleatorio = Math.floor(Math.random() * aleatorioOperaciones.length);
    const valorAleatorio = aleatorioOperaciones[indiceAleatorio];

    const operacion = operaciones[valorAleatorio];

    let numero1 = 0;
    let numero2 = 0;
    let resultado = 0;
    if (decimal) {
      const numeroAleatorio: number = Number((Math.random() * (99.9 - 10.0) + 10.0).toFixed(1));
      numero1 = tienda ? this.resultadoTienda : numeroAleatorio;
      const numeroAleatorio2: number = Number((Math.random() * (99.9 - 10.0) + 10.0).toFixed(1));
      numero2 = numeroAleatorio2;
    } else {
      const numeroAleatorio3: number = Math.floor(Math.random() * 99) + 1;
      numero1 = tienda ? this.resultadoTienda : numeroAleatorio3;
      const numeroAleatorio4: number = Math.floor(Math.random() * 99) + 1;
      numero2 = numeroAleatorio4;
      console.log(numero1, numero2)
    }

    switch (operacion) {
      case '+':
        resultado = numero1 + numero2
        break;
      case '-':
        resultado = numero1 - numero2
        break;
      case '*':
        resultado = numero1 * numero2
        break;
      case '/':
        resultado = numero1 / numero2
        break;
    }
    this.resultadoTienda = resultado;

    const inputText1 = document.getElementById('numero1');
    (inputText1 as HTMLInputElement).value = numero1.toString();
    const inputText2 = document.getElementById('numero2');
    (inputText2 as HTMLInputElement).value = numero2.toString();
    const operacionText = document.getElementById('operacion');
    (operacionText as HTMLInputElement).value = operacion;
    const resultadoText = document.getElementById('resultado');
    (resultadoText as HTMLInputElement).value = '';
  }

  mostrarResultado() {
    alert(this.resultadoTienda);
  }

  onEnterResultadoTienda() {
    const resultadoText = document.getElementById('resultado');
    const resultado = (resultadoText as HTMLInputElement).value;
    if (parseFloat(resultado) == this.resultadoTienda || this.operacionResultado == resultado) {
      (resultadoText as HTMLInputElement).value = '';
    } else {
      alert("Te fallo amigo, vuelve a intentarlo. ntp.");
      (resultadoText as HTMLInputElement).value = '';
    }

  }
  generarJuegMatematicPorcentaje() {
    const decimal = this.controlesTienda.get('decimal')?.value;

    let numero1 = 0;
    let numero2 = 0;
    let resultado = 0;
    if (decimal) {
      const numeroAleatorio: number = Number((Math.random() * (99.9 - 10.0) + 10.0).toFixed(1));
      numero1 = numeroAleatorio;
      const numeroAleatorio2: number = Math.floor(Math.random() * 10) + 1;
      numero2 = numeroAleatorio2;
    } else {
      const numeroAleatorio3: number = Math.floor(Math.random() * 99) + 1;
      numero1 = numeroAleatorio3;
      const numeroAleatorio4: number = Math.floor(Math.random() * 10) + 1;
      numero2 = numeroAleatorio4;
    }

    resultado = (numero2 / 100) * numero1;

    const inputText1 = document.getElementById('numero1');
    (inputText1 as HTMLInputElement).value = numero2.toString();
    const inputText2 = document.getElementById('numero2');
    (inputText2 as HTMLInputElement).value = numero1.toString();
    const operacionText = document.getElementById('operacion');
    (operacionText as HTMLInputElement).value = '%';
    const resultadoText = document.getElementById('resultado');
    (resultadoText as HTMLInputElement).value = '';

    this.resultadoTienda = parseFloat((resultado).toFixed(1));
  }

  generarJuegMatematicRaiz() {
    const numeroAleatorio3: number = Math.floor(Math.random() * 99) + 1;
    const resultado = Math.sqrt(numeroAleatorio3);
    const inputText1 = document.getElementById('numero1');
    (inputText1 as HTMLInputElement).value = numeroAleatorio3.toString();
    const operacionText = document.getElementById('operacion');
    (operacionText as HTMLInputElement).value = 'Raiz';
    const inputText2 = document.getElementById('numero2');
    (inputText2 as HTMLInputElement).value = '';
    this.resultadoTienda = parseFloat((resultado).toFixed(1));
    const resultadoText = document.getElementById('resultado');
    (resultadoText as HTMLInputElement).value = '';
  }

  generarJuegMatematicCompletar() {
    const decimal = this.controlesTienda.get('decimal')?.value;
    const tienda = this.controlesTienda.get('tienda')?.value;
    const suma = this.controlesTienda.get('suma')?.value;
    const resta = this.controlesTienda.get('resta')?.value;
    const multiplicacion = this.controlesTienda.get('multiplicacion')?.value;
    const divicion = this.controlesTienda.get('divicion')?.value;

    let operaciones = ['+', '-', '*', '/'];
    let aleatorioOperaciones = []

    if (suma) { aleatorioOperaciones.push(0); }
    if (resta) aleatorioOperaciones.push(1);
    if (multiplicacion) aleatorioOperaciones.push(2);
    if (divicion) aleatorioOperaciones.push(3);
    const indiceAleatorio = Math.floor(Math.random() * aleatorioOperaciones.length);
    const valorAleatorio = aleatorioOperaciones[indiceAleatorio];

    const operacion = operaciones[valorAleatorio];

    let numero1 = 0;
    let numero2 = 0;
    let resultado = 0;
    if (decimal) {
      const numeroAleatorio: number = Number((Math.random() * (99.9 - 10.0) + 10.0).toFixed(1));
      numero1 = tienda ? this.resultadoTienda : numeroAleatorio;
      const numeroAleatorio2: number = Number((Math.random() * (99.9 - 10.0) + 10.0).toFixed(1));
      numero2 = numeroAleatorio2;
    } else {
      const numeroAleatorio3: number = Math.floor(Math.random() * 99) + 1;
      numero1 = tienda ? this.resultadoTienda : numeroAleatorio3;
      const numeroAleatorio4: number = Math.floor(Math.random() * 99) + 1;
      numero2 = numeroAleatorio4;
      console.log(numero1, numero2)
    }

    switch (operacion) {
      case '+':
        resultado = numero1 + numero2
        break;
      case '-':
        resultado = numero1 - numero2
        break;
      case '*':
        resultado = numero1 * numero2
        break;
      case '/':
        resultado = numero1 / numero2
        break;
    }
    this.resultadoTienda = -1;
    this.operacionResultado = operacion;

    const inputText1 = document.getElementById('numero1');
    (inputText1 as HTMLInputElement).value = numero1.toString();
    const inputText2 = document.getElementById('numero2');
    (inputText2 as HTMLInputElement).value = resultado.toString();
    const operacionText = document.getElementById('operacion');
    (operacionText as HTMLInputElement).value = numero2.toString();
    const resultadoText = document.getElementById('resultado');
    //(resultadoText as HTMLInputElement).value = ;
  }

  escribirHistoriaDibujo() {
    this.textoAEditar = this.dibujoModel.historia;
    this.controlTextPlus='dibujo';
    this.mostrarTextPlus.set(true);
  }

  //-===========================================================
  //Matematicas
  //============================================================

  generarJuegMatematic() {
    const operacionElegida = this.controlesTienda.get('juegoSeleccionada')?.value;
    console.log(operacionElegida)
    switch (operacionElegida) {
      case 'operaciones':
        this.generarJuegMatematicTienda();
        break;
      case 'raiz':
        this.generarJuegMatematicRaiz();
        break;
      case 'porcentaje':
        this.generarJuegMatematicPorcentaje();
        break;
      case 'completar':
        this.generarJuegMatematicCompletar();
        break;
    }
  }

  generarAleatorioId():string{
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789';
    const aleatorio = Array.from(
      { length: 3 },
      () => caracteres[Math.floor(Math.random() * caracteres.length)]
    ).join('');
    return aleatorio;
  }
}
