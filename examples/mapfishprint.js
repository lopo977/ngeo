goog.provide('app.mapfishprint');

/** @suppress {extraRequire} */
goog.require('ngeo.proj.EPSG21781');
goog.require('ngeo.CreatePrint');
goog.require('ngeo.Print');
goog.require('ngeo.PrintUtils');
/** @suppress {extraRequire} */
goog.require('ngeo.mapDirective');
goog.require('ol.Map');
goog.require('ol.View');
goog.require('ol.format.GeoJSON');
goog.require('ol.layer.Image');
goog.require('ol.layer.Vector');
goog.require('ol.source.ImageWMS');
goog.require('ol.source.Vector');


/** @type {!angular.Module} **/
app.module = angular.module('app', ['ngeo']);


/**
 * @const
 * @private
 */
app.WMS_URL_ = 'https://geomapfish-demo.camptocamp.net/2.2/wsgi/' +
    'mapserv_proxy';


/**
 * @const
 * @private
 */
app.PRINT_URL_ = 'https://geomapfish-demo.camptocamp.net/2.2/wsgi/' +
    'printproxy';


/**
 * @const
 * @private
 */
app.PRINT_SCALES_ = [100, 250, 500, 2500, 5000, 10000, 25000, 50000,
  100000, 500000];


/**
 * @const
 * @private
 */
app.PRINT_FORMAT_ = 'pdf';


/**
 * @const
 * @private
 */
app.PRINT_LAYOUT_ = 'A4 portrait';


/**
 * @const
 * @private
 */
app.PRINT_DPI_ = 72;


/**
 * @const
 * @private
 */
app.PRINT_PAPER_SIZE_ = [555, 675];


/**
 * @constructor
 * @param {angular.$timeout} $timeout Angular timeout service.
 * @param {ngeo.CreatePrint} ngeoCreatePrint The ngeo Create Print function.
 * @param {ngeo.PrintUtils} ngeoPrintUtils The ngeo PrintUtils service.
 * @ngInject
 * @export
 */
app.MainController = function($timeout, ngeoCreatePrint, ngeoPrintUtils) {
  /**
   * @type {ol.Map}
   * @export
   */
  this.map = new ol.Map({
    layers: [
      new ol.layer.Image({
        source: new ol.source.ImageWMS({
          url: app.WMS_URL_,
          params: {
            'LAYERS': 'osm'
          },
          serverType: /** @type {ol.source.WMSServerType} */ ('mapserver')
        })
      }),
      new ol.layer.Vector({
        source: new ol.source.Vector({
          url: 'data/polygon-swizerland.json',
          format: new ol.format.GeoJSON({
            defaultDataProjection: 'EPSG:21781'
          })
        })
      })
    ],
    view: new ol.View({
      projection: 'EPSG:21781',
      resolutions: [200, 100, 50, 20, 10, 5, 2.5, 2, 1],
      center: [537635, 152640],
      zoom: 3
    })
  });

  /**
   * Text to display a "loading" message while waiting for the report.
   * @type {string}
   * @export
   */
  this.printState = '';

  /**
   * @type {angular.$timeout}
   * @private
   */
  this.$timeout_ = $timeout;

  /**
   * @type {ngeo.Print}
   * @private
   */
  this.print_ = ngeoCreatePrint(app.PRINT_URL_);

  /**
   * @type {ngeo.PrintUtils}
   * @private
   */
  this.printUtils_ = ngeoPrintUtils;

  /**
   * @type {function(ol.render.Event)}
   */
  const postcomposeListener = ngeoPrintUtils.createPrintMaskPostcompose(
      /**
       * @return {ol.Size} Size in dots of the map to print.
       */
      () => app.PRINT_PAPER_SIZE_,
      /**
       * @param {olx.FrameState} frameState Frame state.
       * @return {number} Scale of the map to print.
       */
      (frameState) => {
        const mapSize = frameState.size;
        const mapResolution = frameState.viewState.resolution;
        // we test mapSize and mapResolution just to please the compiler
        return mapSize !== undefined && mapResolution !== undefined ?
            ngeoPrintUtils.getOptimalScale(mapSize, mapResolution,
                app.PRINT_PAPER_SIZE_, app.PRINT_SCALES_) :
            app.PRINT_SCALES_[0];
      });

  /**
   * Draw the print window in a map postcompose listener.
   */
  this.map.on('postcompose', postcomposeListener);
};


/**
 * @export
 */
app.MainController.prototype.print = function() {
  const map = this.map;

  const mapSize = map.getSize();
  const viewResolution = map.getView().getResolution();

  // we test mapSize and viewResolution just to please the compiler
  const scale = mapSize !== undefined && viewResolution !== undefined ?
      this.printUtils_.getOptimalScale(mapSize, viewResolution,
          app.PRINT_PAPER_SIZE_, app.PRINT_SCALES_) :
      app.PRINT_SCALES_[0];

  const dpi = app.PRINT_DPI_;
  const format = app.PRINT_FORMAT_;
  const layout = app.PRINT_LAYOUT_;

  this.printState = 'Printing...';

  const spec = this.print_.createSpec(map, scale, dpi, layout, format, {
    'datasource': [],
    'debug': 0,
    'comments': 'My comments',
    'title': 'My print'
  });

  this.print_.createReport(spec).then(
      this.handleCreateReportSuccess_.bind(this),
      this.handleCreateReportError_.bind(this)
  );
};


/**
 * @param {!angular.$http.Response} resp Response.
 * @private
 */
app.MainController.prototype.handleCreateReportSuccess_ = function(resp) {
  const mfResp = /** @type {MapFishPrintReportResponse} */ (resp.data);
  this.getStatus_(mfResp.ref);
};


/**
 * @param {string} ref Ref.
 * @private
 */
app.MainController.prototype.getStatus_ = function(ref) {
  this.print_.getStatus(ref).then(
      this.handleGetStatusSuccess_.bind(this, ref),
      this.handleGetStatusError_.bind(this)
  );
};


/**
 * @param {!angular.$http.Response} resp Response.
 * @private
 */
app.MainController.prototype.handleCreateReportError_ = function(resp) {
  this.printState = 'Print error';
};


/**
 * @param {string} ref Ref.
 * @param {!angular.$http.Response} resp Response.
 * @private
 */
app.MainController.prototype.handleGetStatusSuccess_ = function(ref, resp) {
  const mfResp = /** @type {MapFishPrintStatusResponse} */ (resp.data);
  const done = mfResp.done;
  if (done) {
    // The report is ready. Open it by changing the window location.
    this.printState = '';
    window.location.href = this.print_.getReportUrl(ref);
  } else {
    // The report is not ready yet. Check again in 1s.
    const that = this;
    this.$timeout_(() => {
      that.getStatus_(ref);
    }, 1000, false);
  }
};


/**
 * @param {!angular.$http.Response} resp Response.
 * @private
 */
app.MainController.prototype.handleGetStatusError_ = function(resp) {
  this.printState = 'Print error';
};


app.module.controller('MainController', app.MainController);
