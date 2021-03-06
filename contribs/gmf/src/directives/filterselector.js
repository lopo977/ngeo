goog.provide('gmf.filterselectorComponent');

goog.require('gmf');
/** @suppress {extraRequire} */
goog.require('gmf.Authentication');
/** @suppress {extraRequire} */
goog.require('gmf.DataSourcesHelper');
/** @suppress {extraRequire} */
goog.require('ngeo.filterComponent');
goog.require('ngeo.Notification');
goog.require('ngeo.RuleHelper');
goog.require('ol.CollectionEventType');


gmf.FilterselectorController = class {

  /**
   * @param {!angular.Scope} $scope Angular scope.
   * @param {angularGettext.Catalog} gettextCatalog Gettext catalog.
   * @param {gmf.DataSourcesHelper} gmfDataSourcesHelper Gmf data sources
   *     helper service.
   * @param {gmfx.User} gmfUser User.
   * @param {ngeo.Notification} ngeoNotification Ngeo notification service.
   * @param {!ngeo.RuleHelper} ngeoRuleHelper Ngeo rule helper service.
   * @private
   * @ngInject
   * @ngdoc controller
   * @ngname GmfFilterselectorController
   */
  constructor($scope, gettextCatalog, gmfDataSourcesHelper, gmfUser,
      ngeoNotification, ngeoRuleHelper
  ) {

    // Binding properties

    /**
     * @type {boolean}
     * @export
     */
    this.active;

    $scope.$watch(
      () => this.active,
      this.toggleDataSourceRegistration_.bind(this)
    );

    /**
     * @type {!ol.Map}
     * @export
     */
    this.map;

    /**
     * @type {string}
     * @export
     */
    this.toolGroup;


    // Injected properties

    /**
     * @type {angularGettext.Catalog}
     * @private
     */
    this.gettextCatalog_ = gettextCatalog;

    /**
     * @type {gmf.DataSourcesHelper}
     * @private
     */
    this.gmfDataSourcesHelper_ = gmfDataSourcesHelper;

    /**
     * @type {gmfx.User}
     * @private
     */
    this.gmfUser_ = gmfUser;

    $scope.$watch(
      () => this.gmfUser_.functionalities,
      this.handleGmfUserFunctionalitiesChange_.bind(this)
    );

    /**
     * @type {ngeo.Notification}
     * @private
     */
    this.ngeoNotification_ = ngeoNotification;

    /**
     * @type {!ngeo.RuleHelper}
     * @private
     */
    this.ngeoRuleHelper_ = ngeoRuleHelper;


    // Inner properties

    /**
     * @type {Array.<ngeo.rule.Rule>}
     * @export
     */
    this.customRules = null;

    /**
     * @type {Array.<ngeo.rule.Rule>}
     * @export
     */
    this.directedRules = null;

    /**
     * @type {Array.<gmf.DataSource>}
     * @export
     */
    this.filtrableDataSources = [];

    /**
     * @type {Array.<string>}
     * @private
     */
    this.filtrableLayerNodeNames_ = null;

    /**
     * @type {gmf.DataSources}
     * @private
     */
    this.gmfDataSources_ = gmfDataSourcesHelper.collection;

    /**
     * @type {Array.<ol.EventsKey>}
     * @private
     */
    this.listenerKeys_ = [];

    /**
     * The data source ready to be filtered, after it has been selected and
     * prepared.
     * @type {?gmf.DataSource}
     * @export
     */
    this.readyDataSource = null;

    /**
     * @type {!gmf.FilterselectorController.RuleCache}
     * @private
     */
    this.ruleCache_ = {};

    /**
     * The data source that has been selected in the list and that requires
     * to be ready before it can be filtered.
     * @type {?gmf.DataSource}
     * @export
     */
    this.selectedDataSource = null;

    $scope.$watch(
      () => this.selectedDataSource,
      this.handleSelectedDataSourceChange_.bind(this)
    );

    /**
     * @type {boolean}
     * @export
     */
    this.enableDataSourceRegistration_ = false;

    $scope.$watch(
      () => this.enableDataSourceRegistration_,
      this.handleEnableDataSourceRegistrationChange_.bind(this)
    );

    // Initialize the data sources registration
    this.toggleDataSourceRegistration_();
  }


  /**
   * @private
   */
  handleGmfUserFunctionalitiesChange_() {
    const usrFunc = this.gmfUser_.functionalities;
    if (usrFunc && usrFunc['filterable_layers']) {
      this.filtrableLayerNodeNames_ = usrFunc['filterable_layers'];
    } else {
      this.filtrableLayerNodeNames_ = null;
    }
    this.toggleDataSourceRegistration_();
  }


  /**
   * @private
   */
  toggleDataSourceRegistration_() {
    const newDataSourceRegistration = this.active &&
          !!this.filtrableLayerNodeNames_;
    if (this.enableDataSourceRegistration_ !== newDataSourceRegistration) {
      this.enableDataSourceRegistration_ = newDataSourceRegistration;
    }
  }


  /**
   * @param {boolean} register Whether register the data sources or not.
   * @private
   */
  handleEnableDataSourceRegistrationChange_(register) {
    const keys = this.listenerKeys_;

    if (register) {
      // Listen to data sources being added/removed
      keys.push(
        ol.events.listen(
          this.gmfDataSources_,
          ol.CollectionEventType.ADD,
          this.handleDataSourcesAdd_,
          this
        )
      );
      keys.push(
        ol.events.listen(
          this.gmfDataSources_,
          ol.CollectionEventType.REMOVE,
          this.handleDataSourcesRemove_,
          this
        )
      );

      // Manage the data sources that are already in the collection
      this.gmfDataSources_.forEach(this.registerDataSource_, this);

    } else {
      ol.Observable.unByKey(keys);
      keys.length = 0;

      // Remove data sources that are in the collection
      this.filtrableDataSources.length = 0;
    }
  }


  /**
   * Called when a data source is added to the collection of ngeo data sources.
   * If the data source is 'valid', add it to the list of filtrable data
   * sources.
   *
   * @param {ol.Collection.Event} evt Collection event.
   * @private
   */
  handleDataSourcesAdd_(evt) {
    const dataSource = evt.element;
    goog.asserts.assertInstanceof(dataSource, gmf.DataSource);
    this.registerDataSource_(dataSource);
  }


  /**
   * Called when a data source is added to the collection of ngeo data sources.
   * If the data source is 'valid', add it to the list of filtrable data
   * sources.
   *
   * @param {ol.Collection.Event} evt Collection event.
   * @private
   */
  handleDataSourcesRemove_(evt) {
    const dataSource = evt.element;
    goog.asserts.assertInstanceof(dataSource, gmf.DataSource);
    this.unregisterDataSource_(dataSource);
  }


  /**
   * @param {gmf.DataSource} dataSource Data source
   * @private
   */
  registerDataSource_(dataSource) {
    // Do nothing if data source is not filtrable
    if (!this.isDataSourceFiltrable_(dataSource)) {
      return;
    }

    this.filtrableDataSources.push(dataSource);
  }


  /**
   * @param {gmf.DataSource} dataSource Data source
   * @private
   */
  unregisterDataSource_(dataSource) {
    // Do nothing if data source is not filtrable
    if (!this.isDataSourceFiltrable_(dataSource)) {
      return;
    }

    ol.array.remove(this.filtrableDataSources, dataSource);
  }


  /**
   * Determines whether the data source is valid for addition (or removal) to
   * the list of filtrable data sources or not.
   *
   * To be filtrable, the data source must:
   *
   *  1) have its name in the list of filtrable layer node names
   *  2) support WFS
   *  3) have only one ogcLayers defined
   *  4) the ogcLayer must be queryable
   *
   * If 1) is true but not any of the others, then the server has not been
   * configured properly. In this case, a warning notification can be shown.
   *
   * @param {gmf.DataSource} dataSource Ngeo data source object
   * @param {boolean=} opt_notify Whether to show a warning notification or not
   *     in case of a data source that has its name is in the list of
   *     filtrable layer node names but it doesn't match the other requirements.
   *     Defaults to `true.`
   * @return {boolean} Whether the data source is valid to add to the list or
   *     not.
   * @private
   */
  isDataSourceFiltrable_(dataSource, opt_notify) {
    let filtrable = true;
    const gettext = this.gettextCatalog_;
    const notify = opt_notify !== false;
    const names = goog.asserts.assert(this.filtrableLayerNodeNames_);
    const msgs = [];

    // (1) The name of the DS must be in list of filtrable layer node names
    if (ol.array.includes(names, dataSource.name)) {

      // (2) The DS must support WFS
      if (!dataSource.supportsWFS) {
        msgs.push(gettext.getString(
          'The data source doesn\'t support WFS, which is required ' +
          'to fetch the attributes to build the filter rules.'
        ));
      }

      // (3) The DS must have only one ogcLayer
      if (!dataSource.ogcLayers || !dataSource.ogcLayers.length) {
        msgs.push(gettext.getString(
          'The data source must have only 1 ogcLayer defined.'
        ));
      } else if (!dataSource.ogcLayers[0].queryable) {
        // (4) The ogcLayer must be queryable
        msgs.push(gettext.getString(
          'The ogcLayer within the data source must be queryable.'
        ));
      }

      filtrable = !msgs.length;

      // Notify if the name is in list of filtrable layer node names but
      // there are missing requirements.
      if (notify && !filtrable) {
        const p1 = gettext.getString(
          `The following data source is marked as being filtrable,
          but is missing some requirements: `
        );
        const p2 = `${dataSource.name} (${dataSource.id}).`;
        const p3 = gettext.getString(
          `Please, contact your administrator about this.
          Here are the reasons: `
        );
        msgs.unshift(`${p1} ${p2} ${p3}`);
        this.ngeoNotification_.notify({
          msg: msgs.join(' '),
          type: ngeo.MessageType.WARNING
        });
      }
    } else {
      filtrable = false;
    }

    return filtrable;
  }

  /**
   * @param {?gmf.DataSource} dataSource Newly selected data source object.
   * @private
   */
  handleSelectedDataSourceChange_(dataSource) {

    this.customRules = null;
    this.directedRules = null;
    this.readyDataSource = null;

    // No need to do anything if no data source is selected
    if (!dataSource) {
      return;
    }

    this.gmfDataSourcesHelper_.prepareFiltrableDataSource(
      dataSource
    ).then((dataSource) => {

      // Data source is ready. Get any existing rules or create new ones from
      // the attributes
      let item = this.getRuleCacheItem_(dataSource);
      if (!item) {
        item = {
          customRules: [],
          directedRules: []
        };
        this.setRuleCacheItem_(dataSource, item);
        if (dataSource.gmfLayer.metadata &&
            dataSource.gmfLayer.metadata.directedFilterAttributes &&
            dataSource.gmfLayer.metadata.directedFilterAttributes.length
        ) {
          const directedAttributes =
              dataSource.gmfLayer.metadata.directedFilterAttributes;
          const attributes = goog.asserts.assert(dataSource.attributes);
          for (const attribute of attributes) {
            if (ol.array.includes(directedAttributes, attribute.name)) {
              item.directedRules.push(
                this.ngeoRuleHelper_.createRule(attribute)
              );
            }
          }
        }
      }

      this.customRules = item.customRules;
      this.directedRules = item.directedRules;
      this.readyDataSource = dataSource;
    });
  }

  /**
   * @param {ngeo.DataSource} dataSource Data source.
   * @return {?gmf.FilterselectorController.RuleCacheItem} Rule cache item.
   * @private
   */
  getRuleCacheItem_(dataSource) {
    return this.ruleCache_[dataSource.id] || null;
  }

  /**
   * @param {ngeo.DataSource} dataSource Data source.
   * @param {gmf.FilterselectorController.RuleCacheItem} item Rule cache item.
   * @private
   */
  setRuleCacheItem_(dataSource, item) {
    this.ruleCache_[dataSource.id] = item;
  }
};


/**
 * @typedef {Object.<number, !gmf.FilterselectorController.RuleCacheItem>}
 */
gmf.FilterselectorController.RuleCache;


/**
 * @typedef {{
 *     customRules: (Array.<ngeo.rule.Rule>),
 *     directedRules: (Array.<ngeo.rule.Rule>)
 * }}
 */
gmf.FilterselectorController.RuleCacheItem;


gmf.module.component('gmfFilterselector', {
  bindings: {
    active: '<',
    map: '<',
    toolGroup: '<'
  },
  controller: gmf.FilterselectorController,
  controllerAs: 'fsCtrl',
  templateUrl: () => `${gmf.baseTemplateUrl}/filterselector.html`
});
