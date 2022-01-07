import { AfterViewInit, Component, Input, OnInit, Output, ViewChild, ViewEncapsulation } from '@angular/core';


@Component({
  selector: 'ngx-croppie',
  template: `<div #ngxcroppie class="ngx-croppie"></div>`,
  styleUrls: ['./ngx-croppie.css'],
  encapsulation: ViewEncapsulation.None
})
export class NgxCroppieComponent implements OnInit, AfterViewInit {
  @ViewChild('ngxcroppie') element:any;

  @Input() options:any = {
    url: ''
  };
  private oldOptions:Object = {};

  @Input() src:Object = {};
  private oldSrc:Object = {};

  private viewInit:boolean = false;

  private croppie:any;

  constructor() {
  }

  ngOnInit(): void {
  }

  ngAfterViewInit(): void {
      this.viewInit = true;
  }

  ngDoCheck() {
    if (this.viewInit && 
        (
            (JSON.stringify(this.src) !== JSON.stringify(this.oldSrc)) ||
            (JSON.stringify(this.options) !== JSON.stringify(this.oldOptions))
        )
    ) {
      this.options.url = this.oldSrc = this.src;
      this.oldOptions = this.options;
      this.initCroppie();
    }
  }

  private initCroppie(): void {
    if (this.croppie) this.croppie.destroy()
    this.croppie = new Croppie(this.element.nativeElement, this.options);
  }

  public get(){
      return this.croppie.get();
  }

  public rotate(degrees:number){
      return this.croppie.rotate(degrees);
  }

  public setZoom(value:number){
      return this.croppie.setZoom(value);
  }

  public destroy(){
      return this.croppie.destroy();
  }

  public result(type:CroppieResultType = CroppieResultType.canvas, 
                size:CroppieResultSize | Object = CroppieResultSize.viewport, 
                format:CroppieResultFormat = CroppieResultFormat.png, 
                quality:Number = 1,
                circle:Boolean = false ): Promise<any>{
      return this.croppie.result({type:type, size:size, format:format, quality:quality, circle:circle});
  }
}

export class Croppie {

  private element:any;
  
  private cssPrefixes = ['Webkit', 'Moz', 'ms'];
  private emptyStyles =  document.createElement('div').style;
  
  private data:any;
  private elements:any;
  private _currentZoom:any;
  private _originalImageWidth:any;
  private _originalImageHeight:any;

  private RESULT_DEFAULTS:any = {
    type: 'canvas',
    format: 'png',
    quality: 1
  };
  private RESULT_FORMATS = ['jpeg', 'webp', 'png'];

  private EXIF_NORM = [1,8,3,6];
  private EXIF_FLIP = [2,7,4,5];

  static CSS_TRANS_ORG:any;
  static CSS_TRANSFORM:any;
  static CSS_USERSELECT:any;
  static globals = {
    translate: 'translate3d'
  }

  private defaults = {
    viewport: {
        width: 100,
        height: 100,
        type: 'square'
    },
    boundary: { },
    orientationControls: {
        enabled: true,
        leftClass: '',
        rightClass: ''
    },
    resizeControls: {
        width: true,
        height: true
    },
    customClass: '',
    showZoomer: true,
    enableZoom: true,
    enableResize: false,
    mouseWheelZoom: true,
    enableExif: false,
    enforceBoundary: true,
    enableOrientation: false,
    enableKeyMovement: true,
    update: () => { }
  };

  private options:any = {
    translate: 'translate3d'
  }

  private _debouncedOverlay:any;

  constructor (_element:any, opts?:any) {
    
    /* Polyfills */
    /* if ( typeof window.CustomEvent !== "function" ) {
      (function(){
          CustomEvent ( event:any, params:any ) {
              params = params || { bubbles: false, cancelable: false, detail: undefined };
              let evt = document.createEvent( 'CustomEvent' );
              evt.initCustomEvent( event, params.bubbles, params.cancelable, params.detail );
              return evt;
          }
          CustomEvent.prototype = window.Event.prototype;
          window.CustomEvent = <any>CustomEvent;
      }());
    } */

    if (!HTMLCanvasElement.prototype.toBlob) {
        Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
            value: (callback:any, type:any, quality:any) => {
                let _this:any = this;
                let binStr = atob( _this.toDataURL(type, quality).split(',')[1] ),
                len = binStr.length,
                arr = new Uint8Array(len);

                for (let i=0; i<len; i++ ) {
                    arr[i] = binStr.charCodeAt(i);
                }

                callback( new Blob( [arr], {type: type || 'image/png'} ) );
            }
        });
    }
    /* End Polyfills */

    Croppie.CSS_TRANSFORM = this.vendorPrefix('transform');
    Croppie.CSS_TRANS_ORG = this.vendorPrefix('transformOrigin');
    Croppie.CSS_USERSELECT = this.vendorPrefix('userSelect');

    this._debouncedOverlay = this.debounce(this._updateOverlay, 500)

    // let element:any = this.element.nativeElement;
    
    if (_element.className.indexOf('croppie-container') > -1) {
        throw new Error("Croppie: Can't initialize croppie more than once");
    }
    this.element = _element;
    this.options = this.deepExtend(this.clone(this.defaults), opts);

    if (_element.tagName.toLowerCase() === 'img') {
        let origImage:any = this.element;
        this.addClass(origImage, 'cr-original-image');
        this.setAttributes(origImage, {'aria-hidden' : 'true', 'alt' : '' });
        let replacementDiv = document.createElement('div');
        _element.parentNode.appendChild(replacementDiv);
        replacementDiv.appendChild(origImage);
        _element = replacementDiv;
        this.options.url = this.options.url || origImage.src;
    }

    this._create.call(this);
    if (this.options.url) {
        let bindOpts = {
            url: this.options.url,
            points: this.options.points
        };
        delete this.options['url'];
        delete this.options['points'];
        this._bind.call(this, bindOpts);
    }
  }

  vendorPrefix(prop:any) {
    if (prop in this.emptyStyles) {
        return prop;
    }

    let capProp = prop[0].toUpperCase() + prop.slice(1),
        i = this.cssPrefixes.length;

    while (i--) {
        prop = this.cssPrefixes[i] + capProp;
        if (prop in this.emptyStyles) {
            return prop;
        }
    }
  }


  getExifOffset(ornt:any, rotate:any) {
    let arr = this.EXIF_NORM.indexOf(ornt) > -1 ? this.EXIF_NORM : this.EXIF_FLIP,
        index = arr.indexOf(ornt),
        offset = (rotate / 90) % arr.length;// 180 = 2%4 = 2 shift exif by 2 indexes

    return arr[(arr.length + index + (offset % arr.length)) % arr.length];
  }

  // Credits to : Andrew Dupont - http://andrewdupont.net/2009/08/28/deep-extending-objects-in-javascript/
  deepExtend(destination:any, source:any) {
      destination = destination || {};
      for (let property in source) {
          if (source[property] && source[property].constructor && source[property].constructor === Object) {
              destination[property] = destination[property] || {};
              this.deepExtend(destination[property], source[property]);
          } else {
              destination[property] = source[property];
          }
      }
      return destination;
  }

  clone(object:any) {
      return this.deepExtend({}, object);
  }

  debounce(func:any, wait:any, immediate?:any) {
      let timeout:any;
      return () => {
          let context = this, args = arguments;
          let later = () => {
              timeout = null;
              if (!immediate) func.apply(context, args);
          };
          let callNow = immediate && !timeout;
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
          if (callNow) func.apply(context, args);
      };
  }

  dispatchChange(element:any) {
      if ("createEvent" in document) {
          let evt = document.createEvent("HTMLEvents");
          evt.initEvent("change", false, true);
          element.dispatchEvent(evt);
      }
      else {
          element.fireEvent("onchange");
      }
  }

  //http://jsperf.com/vanilla-css
  css(el:any, styles:any = {}, val:any = '') {
      if (typeof (styles) === 'string') {
          let tmp = styles;
          styles = {};
          styles[tmp] = val;
      }

      for (let prop in styles) {
          el.style[prop] = styles[prop];
      }
  }

  addClass(el:any, c:any) {
      if (el.classList) {
        el.classList.add(c);
      }
      else {
          el.className += ' ' + c;
      }
  }

  removeClass(el:any, c:any) {
      if (el.classList) {
          el.classList.remove(c);
      }
      else {
          el.className = el.className.replace(c, '');
      }
  }

  setAttributes(el:any, attrs:any) {
      for (let key in attrs) {
          el.setAttribute(key, attrs[key]);
      }
  }

  num(v:any) {
      return parseInt(v, 10);
  }

  /* Utilities */
  loadImage(src:any, doExif:any) {
      let img:any = new Image();
      img.style.opacity = '0';
      return new Promise((resolve, reject) => {

          let _resolve = () => {
            img.style.opacity = '1';
            setTimeout(()=>{
              resolve(img);
            }, 1);
          }
          
          img.removeAttribute('crossOrigin');
          if (src.match(/^https?:\/\/|^\/\//)) {
              img.setAttribute('crossOrigin', 'anonymous');
          }

          img.onload = () =>{
              if (doExif) {
                let win:any = window;
                win.EXIF.getData(img, () => {
                    _resolve();
                });
              }
              else {
                _resolve();
              }
          };
          img.onerror = (ev:any) => {
              img.style.opacity = 1;
              setTimeout(() => {
                  reject(ev);
              }, 1);
          };
          img.src = src;
      });
  }

  naturalImageDimensions(img:any, ornt:any) {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      let orient = ornt || this.getExifOrientation(img);
      if (orient && orient >= 5) {
          let x= w;
          w = h;
          h = x;
      }
      return { width: w, height: h };
  }

  getExifOrientation (img:any) {
    return img.exifdata && img.exifdata.Orientation ? this.num(img.exifdata.Orientation) : 1;
  }

  drawCanvas(canvas:any, img:any, orientation:any) {
      let width = img.width,
          height = img.height,
          ctx = canvas.getContext('2d');

      canvas.width = img.width;
      canvas.height = img.height;

      ctx.save();
      switch (orientation) {
        case 2:
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
          break;

        case 3:
            ctx.translate(width, height);
            ctx.rotate(180*Math.PI/180);
            break;

        case 4:
            ctx.translate(0, height);
            ctx.scale(1, -1);
            break;

        case 5:
            canvas.width = height;
            canvas.height = width;
            ctx.rotate(90*Math.PI/180);
            ctx.scale(1, -1);
            break;

        case 6:
            canvas.width = height;
            canvas.height = width;
            ctx.rotate(90*Math.PI/180);
            ctx.translate(0, -height);
            break;

        case 7:
            canvas.width = height;
            canvas.height = width;
            ctx.rotate(-90*Math.PI/180);
            ctx.translate(-width, height);
            ctx.scale(1, -1);
            break;

        case 8:
            canvas.width = height;
            canvas.height = width;
            ctx.translate(0, width);
            ctx.rotate(-90*Math.PI/180);
            break;
      }
      ctx.drawImage(img, 0,0, width, height);
      ctx.restore();
  }

  /* Private Methods */
  _create() {
      let self = this,
          contClass = 'croppie-container',
          customViewportClass = self.options.viewport.type ? 'cr-vp-' + self.options.viewport.type : null,
          boundary, img, viewport, overlay, bw, bh;

      self.options.useCanvas = self.options.enableOrientation || this._hasExif.call(self);
      // Properties on class
      self.data = {};
      self.elements = {};

      boundary = self.elements.boundary = document.createElement('div');
      viewport = self.elements.viewport = document.createElement('div');
      img = self.elements.img = document.createElement('img');
      overlay = self.elements.overlay = document.createElement('div');

      if (self.options.useCanvas) {
          self.elements.canvas = document.createElement('canvas');
          self.elements.preview = self.elements.canvas;
      }
      else {
          self.elements.preview = img;
      }

      this.addClass(boundary, 'cr-boundary');
      boundary.setAttribute('aria-dropeffect', 'none');
      bw = self.options.boundary.width;
      bh = self.options.boundary.height;
      this.css(boundary, {
          width: (bw + (isNaN(bw) ? '' : 'px')),
          height: (bh + (isNaN(bh) ? '' : 'px'))
      });

      this.addClass(viewport, 'cr-viewport');
      if (customViewportClass) {
          this.addClass(viewport, customViewportClass);
      }
      this.css(viewport, {
          width: self.options.viewport.width + 'px',
          height: self.options.viewport.height + 'px'
      });
      viewport.setAttribute('tabindex', "0");

      this.addClass(self.elements.preview, 'cr-image');
      this.setAttributes(self.elements.preview, { 'alt': 'preview', 'aria-grabbed': 'false' });
      this.addClass(overlay, 'cr-overlay');

      this.element.appendChild(boundary);
      boundary.appendChild(self.elements.preview);
      boundary.appendChild(viewport);
      boundary.appendChild(overlay);

      this.addClass(self.element, contClass);
      if (self.options.customClass) {
          this.addClass(self.element, self.options.customClass);
      }

      this._initDraggable.call(this);

      if (self.options.enableZoom) {
        this._initializeZoom.call(self);
      }

      if (self.options.enableResize) {
        this._initializeResize.call(self);
      }
  }

  _hasExif() {
    let win:any = window;
    return this.options.enableExif && win.EXIF;
  }

  _initializeResize () {
    var self = this;
      var wrap = document.createElement('div');
      var isDragging = false;
      var direction:any;
      var originalX:any;
      var originalY:any;
      var minSize = 50;
      var maxWidth:any;
      var maxHeight:any;
      var vr:any;
      var hr:any;

      this.addClass(wrap, 'cr-resizer');
      this.css(wrap, {
          width: this.options.viewport.width + 'px',
          height: this.options.viewport.height + 'px'
      });

      if (this.options.resizeControls.height) {
          vr = document.createElement('div');
          this.addClass(vr, 'cr-resizer-vertical');
          wrap.appendChild(vr);
      }

      if (this.options.resizeControls.width) {
          hr = document.createElement('div');
          this.addClass(hr, 'cr-resizer-horisontal');
          wrap.appendChild(hr);
      }

      const mouseDown = (ev:any) => {
          if (ev.button !== undefined && ev.button !== 0) return;

          ev.preventDefault();
          if (isDragging) {
              return;
          }

          let overlayRect = self.elements.overlay.getBoundingClientRect();

          isDragging = true;
          originalX = ev.pageX;
          originalY = ev.pageY;
          direction = ev.currentTarget.className.indexOf('vertical') !== -1 ? 'v' : 'h';
          maxWidth = overlayRect.width;
          maxHeight = overlayRect.height;

          if (ev.touches) {
              let touches = ev.touches[0];
              originalX = touches.pageX;
              originalY = touches.pageY;
          }

          window.addEventListener('mousemove', mouseMove);
          window.addEventListener('touchmove', mouseMove);
          window.addEventListener('mouseup', mouseUp);
          window.addEventListener('touchend', mouseUp);
          document.body.style[Croppie.CSS_USERSELECT] = 'none';
      }

      const mouseMove = (ev:any) => {
          let pageX = ev.pageX;
          let pageY = ev.pageY;

          ev.preventDefault();

          if (ev.touches) {
              let touches = ev.touches[0];
              pageX = touches.pageX;
              pageY = touches.pageY;
          }

          let deltaX = pageX - originalX;
          let deltaY = pageY - originalY;
          let newHeight = self.options.viewport.height + deltaY;
          let newWidth = self.options.viewport.width + deltaX;

          if (direction === 'v' && newHeight >= minSize && newHeight <= maxHeight) {
            this.css(wrap, {
                height: newHeight + 'px'
            });

            self.options.boundary.height += deltaY;
            this.css(self.elements.boundary, {
                height: self.options.boundary.height + 'px'
            });

            self.options.viewport.height += deltaY;
            this.css(self.elements.viewport, {
                height: self.options.viewport.height + 'px'
            });
          }
          else if (direction === 'h' && newWidth >= minSize && newWidth <= maxWidth) {
            this.css(wrap, {
                width: newWidth + 'px'
            });

            self.options.boundary.width += deltaX;
            this.css(self.elements.boundary, {
                width: self.options.boundary.width + 'px'
            });

            self.options.viewport.width += deltaX;
            this.css(self.elements.viewport, {
                width: self.options.viewport.width + 'px'
            });
          }

          this._updateOverlay.call(self);
          this._updateZoomLimits.call(self);
          this. _updateCenterPoint.call(self);
          this. _triggerUpdate.call(self);
          originalY = pageY;
          originalX = pageX;
      }

      const mouseUp = () => {
          isDragging = false;
          window.removeEventListener('mousemove', mouseMove);
          window.removeEventListener('touchmove', mouseMove);
          window.removeEventListener('mouseup', mouseUp);
          window.removeEventListener('touchend', mouseUp);
          document.body.style[Croppie.CSS_USERSELECT] = '';
      }

      if (vr) {
          vr.addEventListener('mousedown', mouseDown);
          vr.addEventListener('touchstart', mouseDown);
      }

      if (hr) {
          hr.addEventListener('mousedown', mouseDown);
          hr.addEventListener('touchstart', mouseDown);
      }

      this.elements.boundary.appendChild(wrap);
  }

  _setZoomerVal(v:any) {
      if (this.options.enableZoom) {
          let z = this.elements.zoomer,
            val:any = this.fix(v, 4);

          z.value = Math.max(parseFloat(z.min), Math.min(parseFloat(z.max), val)).toString();
      }
  }

  _initializeZoom() {
      var self:any = this,
          wrap = self.elements.zoomerWrap = document.createElement('div'),
          zoomer = self.elements.zoomer = document.createElement('input');

      this.addClass(wrap, 'cr-slider-wrap');
      this.addClass(zoomer, 'cr-slider');
      zoomer.type = 'range';
      zoomer.step = '0.0001';
      zoomer.value = '1';
      zoomer.style.display = self.options.showZoomer ? '' : 'none';
      zoomer.setAttribute('aria-label', 'zoom');

      self.element.appendChild(wrap);
      wrap.appendChild(zoomer);

      self._currentZoom = 1;

      const change = () => {
          this._onZoom.call(self, {
              value: parseFloat(zoomer.value),
              origin: new TransformOrigin(self.elements.preview),
              viewportRect: self.elements.viewport.getBoundingClientRect(),
              transform: Transform.parse(self.elements.preview)
          });
      }

      const scroll = (ev:any):any => {
          let delta, targetZoom;

          if(self.options.mouseWheelZoom === 'ctrl' && ev.ctrlKey !== true){
            return 0;
          } else if (ev.wheelDelta) {
              delta = ev.wheelDelta / 1200; //wheelDelta min: -120 max: 120 // max x 10 x 2
          } else if (ev.deltaY) {
              delta = ev.deltaY / 1060; //deltaY min: -53 max: 53 // max x 10 x 2
          } else if (ev.detail) {
              delta = ev.detail / -60; //delta min: -3 max: 3 // max x 10 x 2
          } else {
              delta = 0;
          }

          targetZoom = self._currentZoom + (delta * self._currentZoom);

          ev.preventDefault();
          this._setZoomerVal.call(self, targetZoom);
          change.call(self);
      }

      self.elements.zoomer.addEventListener('input', change);// this is being fired twice on keypress
      self.elements.zoomer.addEventListener('change', change);

      if (self.options.mouseWheelZoom) {
          self.elements.boundary.addEventListener('mousewheel', scroll);
          self.elements.boundary.addEventListener('DOMMouseScroll', scroll);
      }
  }

  _onZoom(ui:any) {
      var self:any = this,
          transform = ui ? ui.transform : Transform.parse(self.elements.preview),
          vpRect = ui ? ui.viewportRect : self.elements.viewport.getBoundingClientRect(),
          origin = ui ? ui.origin : new TransformOrigin(self.elements.preview);

      const applyCss = () => {
          let transCss:any = {};
          transCss[Croppie.CSS_TRANSFORM] = transform.toString();
          transCss[Croppie.CSS_TRANS_ORG] = origin.toString();
          self.css(self.elements.preview, transCss);
      }

      self._currentZoom = ui ? ui.value : self._currentZoom;
      transform.scale = self._currentZoom;
      self.elements.zoomer.setAttribute('aria-valuenow', self._currentZoom);
      applyCss();

      if (self.options.enforceBoundary) {
          let boundaries = this._getVirtualBoundaries.call(self, vpRect),
              transBoundaries = boundaries.translate,
              oBoundaries = boundaries.origin;

          if (transform.x >= transBoundaries.maxX) {
              origin.x = oBoundaries.minX;
              transform.x = transBoundaries.maxX;
          }

          if (transform.x <= transBoundaries.minX) {
              origin.x = oBoundaries.maxX;
              transform.x = transBoundaries.minX;
          }

          if (transform.y >= transBoundaries.maxY) {
              origin.y = oBoundaries.minY;
              transform.y = transBoundaries.maxY;
          }

          if (transform.y <= transBoundaries.minY) {
              origin.y = oBoundaries.maxY;
              transform.y = transBoundaries.minY;
          }
      }
      applyCss();
      this._debouncedOverlay.call(self);
      this._triggerUpdate.call(self);
  }

  _getVirtualBoundaries(viewport:any) {
      let self = this,
          scale = self._currentZoom,
          vpWidth = viewport.width,
          vpHeight = viewport.height,
          centerFromBoundaryX = self.elements.boundary.clientWidth / 2,
          centerFromBoundaryY = self.elements.boundary.clientHeight / 2,
          imgRect = self.elements.preview.getBoundingClientRect(),
          curImgWidth = imgRect.width,
          curImgHeight = imgRect.height,
          halfWidth = vpWidth / 2,
          halfHeight = vpHeight / 2;

      let maxX = ((halfWidth / scale) - centerFromBoundaryX) * -1;
      let minX = maxX - ((curImgWidth * (1 / scale)) - (vpWidth * (1 / scale)));

      let maxY = ((halfHeight / scale) - centerFromBoundaryY) * -1;
      let minY = maxY - ((curImgHeight * (1 / scale)) - (vpHeight * (1 / scale)));

      let originMinX = (1 / scale) * halfWidth;
      let originMaxX = (curImgWidth * (1 / scale)) - originMinX;

      let originMinY = (1 / scale) * halfHeight;
      let originMaxY = (curImgHeight * (1 / scale)) - originMinY;

      return {
          translate: {
              maxX: maxX,
              minX: minX,
              maxY: maxY,
              minY: minY
          },
          origin: {
              maxX: originMaxX,
              minX: originMinX,
              maxY: originMaxY,
              minY: originMinY
          }
      };
  }

  _updateCenterPoint(rotate?:any) {
      var self:any = this,
          scale = self._currentZoom,
          data = self.elements.preview.getBoundingClientRect(),
          vpData = self.elements.viewport.getBoundingClientRect(),
          transform = Transform.parse(self.elements.preview.style[Croppie.CSS_TRANSFORM]),
          pc = new TransformOrigin(self.elements.preview),
          top = (vpData.top - data.top) + (vpData.height / 2),
          left = (vpData.left - data.left) + (vpData.width / 2),
          center:any = {},
          adj:any = {};

      if (rotate) {
          let cx = pc.x;
          let cy = pc.y;
          let tx = transform.x;
          let ty = transform.y;

          center.y = cx;
          center.x = cy;
          transform.y = tx;
          transform.x = ty;
      }
      else {
          center.y = top / scale;
          center.x = left / scale;

          adj.y = (center.y - pc.y) * (1 - scale);
          adj.x = (center.x - pc.x) * (1 - scale);

          transform.x -= adj.x;
          transform.y -= adj.y;
      }

      let newCss:any = {};
      newCss[Croppie.CSS_TRANS_ORG] = center.x + 'px ' + center.y + 'px';
      newCss[Croppie.CSS_TRANSFORM] = transform.toString();
      this.css(self.elements.preview, newCss);
  }

  _initDraggable() {
      var self:any = this,
          isDragging = false,
          originalX:any,
          originalY:any,
          originalDistance:any,
          vpRect:any,
          transform:any;

      const assignTransformCoordinates = (deltaX:any, deltaY:any) => {
          let imgRect = self.elements.preview.getBoundingClientRect(),
              top = transform.y + deltaY,
              left = transform.x + deltaX;

          if (self.options.enforceBoundary) {
              if (vpRect.top > imgRect.top + deltaY && vpRect.bottom < imgRect.bottom + deltaY) {
                  transform.y = top;
              }

              if (vpRect.left > imgRect.left + deltaX && vpRect.right < imgRect.right + deltaX) {
                  transform.x = left;
              }
          }
          else {
              transform.y = top;
              transform.x = left;
          }
      }

      const toggleGrabState = (isDragging:any) => {
        self.elements.preview.setAttribute('aria-grabbed', isDragging);
        self.elements.boundary.setAttribute('aria-dropeffect', isDragging? 'move': 'none');
      }

      const keyDown = (ev:any) => {
          let LEFT_ARROW  = 37,
              UP_ARROW    = 38,
              RIGHT_ARROW = 39,
              DOWN_ARROW  = 40;

          const parseKeyDown = (key:any):any => {
            switch (key) {
                case LEFT_ARROW:
                    return [1, 0];
                case UP_ARROW:
                    return [0, 1];
                case RIGHT_ARROW:
                    return [-1, 0];
                case DOWN_ARROW:
                    return [0, -1];
            }
            return [0,0];
          }

          if (ev.shiftKey && (ev.keyCode === UP_ARROW || ev.keyCode === DOWN_ARROW)) {
              let zoom;
              if (ev.keyCode === UP_ARROW) {
                  zoom = parseFloat(self.elements.zoomer.value) + parseFloat(self.elements.zoomer.step)
              }
              else {
                  zoom = parseFloat(self.elements.zoomer.value) - parseFloat(self.elements.zoomer.step)
              }
              self.setZoom(zoom);
          }
          else if (self.options.enableKeyMovement && (ev.keyCode >= 37 && ev.keyCode <= 40)) {
              ev.preventDefault();
              let movement = parseKeyDown(ev.keyCode);

              transform = Transform.parse(self.elements.preview);
              document.body.style[Croppie.CSS_USERSELECT] = 'none';
              vpRect = self.elements.viewport.getBoundingClientRect();
              keyMove(movement);
          }

      }

      const keyMove = (movement:any) => {
          let deltaX = movement[0],
              deltaY = movement[1],
              newCss:any = {};

          assignTransformCoordinates(deltaX, deltaY);

          newCss[Croppie.CSS_TRANSFORM] = transform.toString();
          self.css(self.elements.preview, newCss);
          self._updateOverlay.call(self);
          document.body.style[Croppie.CSS_USERSELECT] = '';
          self._updateCenterPoint.call(self);
          self._triggerUpdate.call(self);
          originalDistance = 0;
      }

      const mouseDown = (ev:any) => {
          if (ev.button !== undefined && ev.button !== 0) return;

          ev.preventDefault();
          if (isDragging) return;
          isDragging = true;
          originalX = ev.pageX;
          originalY = ev.pageY;

          if (ev.touches) {
              let touches = ev.touches[0];
              originalX = touches.pageX;
              originalY = touches.pageY;
          }
          toggleGrabState(isDragging);
          transform = Transform.parse(self.elements.preview);
          window.addEventListener('mousemove', mouseMove);
          window.addEventListener('touchmove', mouseMove);
          window.addEventListener('mouseup', mouseUp);
          window.addEventListener('touchend', mouseUp);
          document.body.style[Croppie.CSS_USERSELECT] = 'none';
          vpRect = self.elements.viewport.getBoundingClientRect();
      }

      const mouseMove = (ev:any) => {
          ev.preventDefault();
          let pageX = ev.pageX,
              pageY = ev.pageY;

          if (ev.touches) {
              let touches = ev.touches[0];
              pageX = touches.pageX;
              pageY = touches.pageY;
          }

          let deltaX = pageX - originalX,
              deltaY = pageY - originalY,
              newCss:any = {};

          if (ev.type === 'touchmove') {
              if (ev.touches.length > 1) {
                  let touch1 = ev.touches[0];
                  let touch2 = ev.touches[1];
                  let dist = Math.sqrt((touch1.pageX - touch2.pageX) * (touch1.pageX - touch2.pageX) + (touch1.pageY - touch2.pageY) * (touch1.pageY - touch2.pageY));

                  if (!originalDistance) {
                      originalDistance = dist / self._currentZoom;
                  }

                  let scale = dist / originalDistance;

                  self._setZoomerVal.call(self, scale);
                  self.dispatchChange(self.elements.zoomer);
                  return;
              }
          }

          assignTransformCoordinates(deltaX, deltaY);

          newCss[Croppie.CSS_TRANSFORM] = transform.toString();
          self.css(self.elements.preview, newCss);
          self._updateOverlay.call(self);
          originalY = pageY;
          originalX = pageX;
      }

      const mouseUp = () => {
          isDragging = false;
          toggleGrabState(isDragging);
          window.removeEventListener('mousemove', mouseMove);
          window.removeEventListener('touchmove', mouseMove);
          window.removeEventListener('mouseup', mouseUp);
          window.removeEventListener('touchend', mouseUp);
          document.body.style[Croppie.CSS_USERSELECT] = '';
          self._updateCenterPoint.call(self);
          self._triggerUpdate.call(self);
          originalDistance = 0;
      }

      self.elements.overlay.addEventListener('mousedown', mouseDown);
      self.elements.viewport.addEventListener('keydown', keyDown);
      self.elements.overlay.addEventListener('touchstart', mouseDown);
  }

  _updateOverlay() {
    if (!this.elements) return; // since this is debounced, it can be fired after destroy
    let self = this,
        boundRect = self.elements.boundary.getBoundingClientRect(),
        imgData = self.elements.preview.getBoundingClientRect();

    self.css(self.elements.overlay, {
        width: imgData.width + 'px',
        height: imgData.height + 'px',
        top: (imgData.top - boundRect.top) + 'px',
        left: (imgData.left - boundRect.left) + 'px'
    });
  }

  _triggerUpdate() {
      let self:any = this,
          data = self.get();

      if (!self._isVisible.call(self)) {
          return;
      }

      self.options.update.call(self, data);
      let win:any = window;
      if (self.$ && typeof win.Prototype === 'undefined') {
          self.$(self.element).trigger('update.croppie', data);
      }
      else {
          let ev;
          if (window.CustomEvent) {
              ev = new CustomEvent('update', { detail: data });
          } else {
              ev = document.createEvent('CustomEvent');
              ev.initCustomEvent('update', true, true, data);
          }

          self.element.dispatchEvent(ev);
      }
  }

  _isVisible() {
      return this.elements.preview.offsetHeight > 0 && this.elements.preview.offsetWidth > 0;
  }

  _updatePropertiesFromImage() {
      let self:any = this,
          initialZoom = 1,
          cssReset:any = {},
          img = self.elements.preview,
          imgData,
          transformReset:any = new Transform(0, 0, initialZoom),
          originReset = new TransformOrigin(),
          isVisible = this._isVisible.call(self);

      if (!isVisible || self.data.bound) {// if the croppie isn't visible or it doesn't need binding
          return;
      }

      self.data.bound = true;
      cssReset[Croppie.CSS_TRANSFORM] = transformReset.toString();
      cssReset[Croppie.CSS_TRANS_ORG] = originReset.toString();
      cssReset['opacity'] = 1;
      self.css(img, cssReset);

      imgData = self.elements.preview.getBoundingClientRect();

      self._originalImageWidth = imgData.width;
      self._originalImageHeight = imgData.height;
      self.data.orientation = self.getExifOrientation(self.elements.img);

      if (self.options.enableZoom) {
        self._updateZoomLimits.call(self, true);
      }
      else {
        self._currentZoom = initialZoom;
      }

      transformReset.scale = self._currentZoom;
      cssReset[Croppie.CSS_TRANSFORM] = transformReset.toString();
      self.css(img, cssReset);

      if (self.data.points.length) {
        self._bindPoints.call(self, self.data.points);
      }
      else {
        self._centerImage.call(self);
      }

      self._updateCenterPoint.call(self);
      self._updateOverlay.call(self);
  }

  _updateZoomLimits (initial?:any) {
    let self = this,
        minZoom = Math.max(self.options.minZoom, 0) || 0,
        maxZoom = self.options.maxZoom || 1.5,
        initialZoom,
        defaultInitialZoom,
        zoomer = self.elements.zoomer,
        scale = parseFloat(zoomer.value),
        boundaryData = self.elements.boundary.getBoundingClientRect(),
        imgData = this.naturalImageDimensions(self.elements.img, self.data.orientation),
        vpData = self.elements.viewport.getBoundingClientRect(),
        minW,
        minH;
    if (self.options.enforceBoundary) {
        minW = vpData.width / imgData.width;
        minH = vpData.height / imgData.height;
        minZoom = Math.max(minW, minH);
    }

    if (minZoom >= maxZoom) {
        maxZoom = minZoom + 1;
    }

    zoomer.min = this.fix(minZoom, 4);
    zoomer.max = this.fix(maxZoom, 4);
    
    if (!initial && (scale < zoomer.min || scale > zoomer.max)) {
      this._setZoomerVal.call(self, scale < zoomer.min ? zoomer.min : zoomer.max);
    }
    else if (initial) {
      defaultInitialZoom = Math.max((boundaryData.width / imgData.width), (boundaryData.height / imgData.height));
      initialZoom = self.data.boundZoom !== null ? self.data.boundZoom : defaultInitialZoom;
      this._setZoomerVal.call(self, initialZoom);
    }

    this.dispatchChange(zoomer);
  }

  _bindPoints(points:any) {
      if (points.length !== 4) {
          throw "Croppie - Invalid number of points supplied: " + points;
      }
      let self = this,
          pointsWidth = points[2] - points[0],
          // pointsHeight = points[3] - points[1],
          vpData = self.elements.viewport.getBoundingClientRect(),
          boundRect = self.elements.boundary.getBoundingClientRect(),
          vpOffset = {
              left: vpData.left - boundRect.left,
              top: vpData.top - boundRect.top
          },
          scale = vpData.width / pointsWidth,
          originTop = points[1],
          originLeft = points[0],
          transformTop = (-1 * points[1]) + vpOffset.top,
          transformLeft = (-1 * points[0]) + vpOffset.left,
          newCss:any = {};

      newCss[Croppie.CSS_TRANS_ORG] = originLeft + 'px ' + originTop + 'px';
      newCss[Croppie.CSS_TRANSFORM] = new Transform(transformLeft, transformTop, scale).toString();
      this.css(self.elements.preview, newCss);

      this._setZoomerVal.call(self, scale);
      self._currentZoom = scale;
  }

  _centerImage() {
      let self = this,
          imgDim = self.elements.preview.getBoundingClientRect(),
          vpDim = self.elements.viewport.getBoundingClientRect(),
          boundDim = self.elements.boundary.getBoundingClientRect(),
          vpLeft = vpDim.left - boundDim.left,
          vpTop = vpDim.top - boundDim.top,
          w = vpLeft - ((imgDim.width - vpDim.width) / 2),
          h = vpTop - ((imgDim.height - vpDim.height) / 2),
          transform = new Transform(w, h, self._currentZoom);

      this.css(self.elements.preview, Croppie.CSS_TRANSFORM, transform.toString());
  }

  _transferImageToCanvas(customOrientation:any) {
      let self = this,
          canvas = self.elements.canvas,
          img = self.elements.img,
          ctx = canvas.getContext('2d');

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = img.width;
      canvas.height = img.height;

      let orientation = self.options.enableOrientation && customOrientation || this.getExifOrientation(img);
      this.drawCanvas(canvas, img, orientation);
  }

  _getCanvas(data:any) {
      var self = this,
          points = data.points,
          left = this.num(points[0]),
          top = this.num(points[1]),
          right = this.num(points[2]),
          bottom = this.num(points[3]),
          width = right-left,
          height = bottom-top,
          circle = data.circle,
          canvas = document.createElement('canvas'),
          ctx:any = canvas.getContext('2d'),
          startX = 0,
          startY = 0,
          canvasWidth = data.outputWidth || width,
          canvasHeight = data.outputHeight || height;

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      if (data.backgroundColor) {
          ctx.fillStyle = data.backgroundColor;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // By default assume we're going to draw the entire
      // source image onto the destination canvas.
      let sx = left,
          sy = top,
          sWidth = width,
          sHeight = height,
          dx = 0,
          dy = 0,
          dWidth = canvasWidth,
          dHeight = canvasHeight;

      //
      // Do not go outside of the original image's bounds along the x-axis.
      // Handle translations when projecting onto the destination canvas.
      //

      // The smallest possible source x-position is 0.
      if (left < 0) {
          sx = 0;
          dx = (Math.abs(left) / width) * canvasWidth;
      }

      // The largest possible source width is the original image's width.
      if (sWidth + sx > self._originalImageWidth) {
          sWidth = self._originalImageWidth - sx;
          dWidth =  (sWidth / width) * canvasWidth;
      }

      //
      // Do not go outside of the original image's bounds along the y-axis.
      //

      // The smallest possible source y-position is 0.
      if (top < 0) {
          sy = 0;
          dy = (Math.abs(top) / height) * canvasHeight;
      }

      // The largest possible source height is the original image's height.
      if (sHeight + sy > self._originalImageHeight) {
          sHeight = self._originalImageHeight - sy;
          dHeight = (sHeight / height) * canvasHeight;
      }

      // console.table({ left, right, top, bottom, canvasWidth, canvasHeight, width, height, startX, startY, circle, sx, sy, dx, dy, sWidth, sHeight, dWidth, dHeight });

      ctx.drawImage(this.elements.preview, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
      if (circle) {
          ctx.fillStyle = '#fff';
          ctx.globalCompositeOperation = 'destination-in';
          ctx.beginPath();
          ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2, true);
          ctx.closePath();
          ctx.fill();
      }
      return canvas;
  }

  _getHtmlResult(data:any) {
    let points = data.points,
        div = document.createElement('div'),
        img = document.createElement('img'),
        width = points[2] - points[0],
        height = points[3] - points[1];

    this.addClass(div, 'croppie-result');
    div.appendChild(img);
    this.css(img, {
        left: (-1 * points[0]) + 'px',
        top: (-1 * points[1]) + 'px'
    });
    img.src = data.url;
    this.css(div, {
        width: width + 'px',
        height: height + 'px'
    });

    return div;
  }

  _getBase64Result(data:any) {
      return this._getCanvas.call(this, data).toDataURL(data.format, data.quality);
  }

  _getBlobResult(data:any) {
      var self = this;
      return new Promise((resolve) => {
        self._getCanvas.call(self, data).toBlob((blob) => {
            resolve(blob);
        }, data.format, data.quality);
      });
  }

  _replaceImage(img:any) {
    if (this.elements.img.parentNode) {
        Array.prototype.forEach.call(this.elements.img.classList, function(c) { img.classList.add(c); });
        this.elements.img.parentNode.replaceChild(img, this.elements.img);
        this.elements.preview = img; // if the img is attached to the DOM, they're not using the canvas
    }
    this.elements.img = img;
  }

  _bind(options?:any, cb?:any) {
      var self:any = this,
          url,
          points:any = [],
          zoom = null,
          hasExif:any = this._hasExif.call(self);

      if (typeof (options) === 'string') {
          url = options;
          options = {};
      }
      else if (Array.isArray(options)) {
          points = options.slice();
      }
      else if (typeof (options) === 'undefined' && self.data.url) { //refreshing
          self._updatePropertiesFromImage.call(self);
          self._triggerUpdate.call(self);
          return null;
      }
      else {
          url = options.url;
          points = options.points || [];
          zoom = typeof(options.zoom) === 'undefined' ? null : options.zoom;
      }

      self.data.bound = false;
      self.data.url = url || self.data.url;
      self.data.boundZoom = zoom;

      return this.loadImage(url, hasExif).then((img:any) => {
          self._replaceImage(img);
          setTimeout(() => {
            if (!points.length) {
                let natDim = self.naturalImageDimensions(img);
                let rect = self.elements.viewport.getBoundingClientRect();
                let aspectRatio = rect.width / rect.height;
                let imgAspectRatio = natDim.width / natDim.height;
                let width, height;

                if (imgAspectRatio > aspectRatio) {
                    height = natDim.height;
                    width = height * aspectRatio;
                }
                else {
                    width = natDim.width;
                    height = natDim.height / aspectRatio;
                }

                let x0 = (natDim.width - width) / 2;
                let y0 = (natDim.height - height) / 2;
                let x1 = x0 + width;
                let y1 = y0 + height;
                self.data.points = [x0, y0, x1, y1];
            }
            else if (self.options.relative) {
                points = [
                    points[0] * img.naturalWidth / 100,
                    points[1] * img.naturalHeight / 100,
                    points[2] * img.naturalWidth / 100,
                    points[3] * img.naturalHeight / 100
                ];
            }

            self.data.points = points.map((p:any) => {
                return parseFloat(p);
            });
            if (self.options.useCanvas) {
                self._transferImageToCanvas.call(self, options.orientation);
            }
            self._updatePropertiesFromImage.call(self);
            self._triggerUpdate.call(self);
            cb && cb();
        }, 300);
      });
  }

  fix(v:any, decimalPoints:any) {
      return parseFloat(v).toFixed(decimalPoints || 0);
  }

  _get() {
      let self:any = this,
          imgData = self.elements.preview.getBoundingClientRect(),
          vpData = self.elements.viewport.getBoundingClientRect(),
          x1 = vpData.left - imgData.left,
          y1 = vpData.top - imgData.top,
          widthDiff = (vpData.width - self.elements.viewport.offsetWidth) / 2, //border
          heightDiff = (vpData.height - self.elements.viewport.offsetHeight) / 2,
          x2 = x1 + self.elements.viewport.offsetWidth + widthDiff,
          y2 = y1 + self.elements.viewport.offsetHeight + heightDiff,
          scale = self._currentZoom;

      if (scale === Infinity || isNaN(scale)) {
          scale = 1;
      }

      let max = self.options.enforceBoundary ? 0 : Number.NEGATIVE_INFINITY;
      x1 = Math.max(max, x1 / scale);
      y1 = Math.max(max, y1 / scale);
      x2 = Math.max(max, x2 / scale);
      y2 = Math.max(max, y2 / scale);

      return {
          points: [self.fix(x1), self.fix(y1), self.fix(x2), self.fix(y2)],
          zoom: scale,
          orientation: self.data.orientation
      };
  }

  _result(options:any) {
      let self = this,
          data:any = self._get.call(self),
          opts = this.deepExtend(this.clone(this.RESULT_DEFAULTS), this.clone(options)),
          resultType = (typeof (options) === 'string' ? options : (opts.type || 'base64')),
          size = opts.size || 'viewport',
          format = opts.format,
          quality = opts.quality,
          backgroundColor = opts.backgroundColor,
          circle = typeof opts.circle === 'boolean' ? opts.circle : (self.options.viewport.type === 'circle'),
          vpRect = self.elements.viewport.getBoundingClientRect(),
          ratio = vpRect.width / vpRect.height,
          prom;

      if (size === 'viewport') {
          data.outputWidth = vpRect.width;
          data.outputHeight = vpRect.height;
      } else if (typeof size === 'object') {
          if (size.width && size.height) {
              data.outputWidth = size.width;
              data.outputHeight = size.height;
          } else if (size.width) {
              data.outputWidth = size.width;
              data.outputHeight = size.width / ratio;
          } else if (size.height) {
              data.outputWidth = size.height * ratio;
              data.outputHeight = size.height;
          }
      }

      if (this.RESULT_FORMATS.indexOf(format) > -1) {
          data.format = 'image/' + format;
          data.quality = quality;
      }

      data.circle = circle;
      data.url = self.data.url;
      data.backgroundColor = backgroundColor;

      prom = new Promise((resolve) => {
          switch(resultType.toLowerCase())
          {
              case 'rawcanvas':
                  resolve(this._getCanvas.call(self, data));
                  break;
              case 'canvas':
              case 'base64':
                  resolve(this._getBase64Result.call(self, data));
                  break;
              case 'blob':
                  this._getBlobResult.call(self, data).then(resolve);
                  break;
              default:
                  resolve(this._getHtmlResult.call(self, data));
                  break;
          }
      });
      return prom;
  }

  _refresh() {
    this._updatePropertiesFromImage.call(this);
  }

  _rotate(deg:any) {
      if (!this.options.useCanvas || !this.options.enableOrientation) {
          throw 'Croppie: Cannot rotate without enableOrientation && EXIF.js included';
      }

      let self = this,
          canvas = self.elements.canvas;

      self.data.orientation = this.getExifOffset(self.data.orientation, deg);
      this.drawCanvas(canvas, self.elements.img, self.data.orientation);
      this._updateCenterPoint.call(self, true);
      this._updateZoomLimits.call(self);
  }

  _destroy() {
      let self = this;
      self.element.removeChild(self.elements.boundary);
      this.removeClass(self.element, 'croppie-container');
      if (self.options.enableZoom) {
          self.element.removeChild(self.elements.zoomerWrap);
      }
      delete self.elements;
  }

  public bind(options:any, cb:any) {
    return this._bind.call(this, options, cb);
  }
  public get() {
    var data:any = this._get.call(this);
    var points = data.points;
    if (this.options.relative) {
        points[0] /= this.elements.img.naturalWidth / 100;
        points[1] /= this.elements.img.naturalHeight / 100;
        points[2] /= this.elements.img.naturalWidth / 100;
        points[3] /= this.elements.img.naturalHeight / 100;
    }
    return data;
  }
  public result(type:any) {
      return this._result.call(this, type);
  }
  public refresh() {
      return this._refresh.call(this);
  }
  public setZoom(v:any) {
    this._setZoomerVal.call(this, v);
      this.dispatchChange(this.elements.zoomer);
  }
  public rotate(deg:any) {
    this._rotate.call(this, deg);
  }
  public destroy() {
      return this._destroy.call(this);
  }
}

export class Transform {

  private TRANSLATE_OPTS:any = {
    'translate3d': {
        suffix: ', 0px'
    },
    'translate': {
        suffix: ''
    }
  };

  private x:number;
  private y:number;
  public scale:number;

  constructor(x:any, y:any, scale:any) {
    this.x = parseFloat(x);
    this.y = parseFloat(y);
    this.scale = parseFloat(scale);
  }

  static parse (v:any):any {
    if (v.style) {
        return this.parse(v.style[Croppie.CSS_TRANSFORM]);
    }
    else if (v.indexOf('matrix') > -1 || v.indexOf('none') > -1) {
      let vals = v.substring(7).split(',');
      if (!vals.length || v === 'none') {
          vals = [1, 0, 0, 1, 0, 0];
      }
      return new Transform(parseInt(vals[4], 10), parseInt(vals[5], 10), parseFloat(vals[0]));
    }
    else {
      let values = v.split(') '),
        translate = values[0].substring(Croppie.globals.translate.length + 1).split(','),
        scale = values.length > 1 ? values[1].substring(6) : 1,
        x = translate.length > 1 ? translate[0] : 0,
        y = translate.length > 1 ? translate[1] : 0;

      return new Transform(x, y, scale);
    }
  };

  toString () {
      let suffix = this.TRANSLATE_OPTS[Croppie.globals.translate].suffix || '';
      return Croppie.globals.translate + '(' + this.x + 'px, ' + this.y + 'px' + suffix + ') scale(' + this.scale + ')';
  };

}

export class TransformOrigin {
  public x:number;
  public y:number;

  constructor(el?: any) {
    if (!el || !el.style[Croppie.CSS_TRANS_ORG]) {
        this.x = 0;
        this.y = 0;
        return;
    }
    let css = el.style[Croppie.CSS_TRANS_ORG].split(' ');
    this.x = parseFloat(css[0]);
    this.y = parseFloat(css[1]);
  }

  toString () {
    return this.x + 'px ' + this.y + 'px';
  };
}

export enum CroppieResultType {
    canvas = "canvas",
    base64 = "base64",
    html = "html",
    blob = "blob",
    rawcanvas = "rawcanvas",
}
export enum CroppieResultSize {
    viewport = "viewport",
    original = "original",
}
export enum CroppieResultFormat {
    png = "png",
    jpeg = "jpeg",
    webp = "webp",
}