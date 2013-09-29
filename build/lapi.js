/**
 * @fileOverview Declares the API namespace
 * the lapi object is simply an adapter layer for the Lagoa platform. It simply wraps application level
 * interfaces (changing parameters of objects in an embed scene).
 * @todo Add platform level functionality such as assets loading, projects and user queries, etc...
 */

/**
 * @namespace lapi
 */
var lapi = {};
/**
 * @ignore
 * @fileOverview implements lapi interfaces to lagoa
 * the lapi object is simply an adapter layer for the Lagoa platform. It is a wrapper of application level
 * API's (for example changing parameters of objects in an embed scene).
 * @todo Add platform level functionality such as assets loading, projects and user queries, etc...
 */

(function(){

  /**
   * Constants
   * @namespace
   */
  lapi.CONSTANTS = {};
  /**
   * Enum for standard console msgs.
   * @enum {string}
   */
  lapi.CONSTANTS.CONSOLE_MSGS = {
    IMMUTABLE : "cannot change this"
  };

  lapi.CONSTANTS.SCENE = {
    LIGHT : "LightID",
    CAMERA : "CameraID",
    MESH : "MeshID",
    MATERIAL : "MaterialID",
    TEXTURE : "TextureID",
    GROUP : "GroupID",
    PROJECTION : "TextureProjectionID"
  };

  /**
   * @type {Number}
   * @private
   */
  lapi._cbStack = 0;

  /**
   * @type {Object}
   * @private
   */
  lapi._cbmap = {};

  /**
   * @type {String}
   * @private
   */
  lapi._lagoaUrl="http://lagoa.com";

  /**
   * @type {number}
   * @private
   */
  lapi._user_id = 24;

  /**
   * @type {number}
   * @private
   */
  lapi._project_id;

  /**
   * @type {string}
   * @private
   */
  lapi._assetGuid;

  /**
   * @type {object}
   * @private
   */
  lapi._objData = {};

  /**
   * @type {{}}
   * @private
   */
  lapi._sceneTimer;

  /**
   * Implements the MPI interface to receive messages back from the lagoa embed
   * @private
   */
  window.addEventListener("message", function(e){
    var retval = JSON.parse(e.data);
    if(retval.channel == 'rpcend') {

//      console.warn("returning RPC call", lapi._cbStack);
//      --lapi._cbStack;

      if(lapi._cbmap[retval.id]){
        var callback = lapi._cbmap[retval.id];
        callback(retval);
        delete lapi._cbmap[retval.id];
      }
    }
  });

  /**
   * @type {string}
   * @private
   */
  lapi._activeCamera = null;

  /**
   * @type {boolean}
   * @private
   */
  lapi._isRendering = false;

  /**
   * Mess with time
   * @type {boolean}
   * @private
   */
  lapi._isPlaying = false;

  /**
   * internal object to store the Time interval callback
   * @type {null}
   * @private
   */
  lapi._timeIntervalId = null;

  /**
   * @type {number}
   * @private
   */
  lapi._frame = 0;

  /**
   * RPC call for SC to execute.
   * @message {string} instructions we want to execute
   * @callback {function} Optional callback. It will use whatever the RPC call returns. Note, that RPC
   * return value is a stringified object we parse. It's not returning a proxy or the actual object.
   * Interactions with the scene will happen only through embedRPC calls.
   */
  lapi._embedRPC = function(message, callback){
    var randName = 'xxxxxxxxxx'.replace(/x/g,function(){return Math.floor(Math.random()*16).toString(16)});
    var iframe = document.getElementById('lagoaframe');
    if(callback){
      lapi._cbmap[randName] = callback;
    }
    iframe.contentWindow.postMessage(JSON.stringify({channel : 'embedrpc', id: randName, command : message}), '*');
    console.warn("API: "+ message);
  };

  /**
   * Active scene loaded in the embed
   * @type {{}}
   * @private
   */
  lapi._activeScene = null;

  /**
   * accessor to return the current loaded scene
   * @returns {Scene}
   */
  lapi.getActiveScene = function(){
    return lapi._activeScene;
  };

  /**
   * Initialize routine to cache embed scene data in local variables.
   */
  lapi._initialize = function(){

    var self = this;

    // grab the things we are interested in.
    // we assume there are CameraID, MeshID, MaterialID, GroupID, TextureID, etc, kind of objects....
    lapi._embedRPC( "var classedItems = ACTIVEAPP.GetClassedItems();" +
      "var sceneKeys = {};" +
      "for( var i in classedItems ){ " +
      " sceneKeys[i] = Object.keys( classedItems[i] );" +
      "};" +
      "sceneKeys;",
      function(e){

        // the classed item includes the scene itself... we handle this specially because
        // it can cause problems.
        var sceneGuid = e.data["SceneID"][0];
        var classedItems = e.data;

        // delete the scene guid because this can cause trouble...
        delete classedItems["SceneID"];
        self._activeScene = new lapi.Scene( sceneGuid, classedItems );

        var cams = self._activeScene.getCameras();
        self._activeCamera = cams[0];

        // give it sometime to call the event...
        setTimeout( lapi.onSceneLoaded, 3000 );
    });
  };

  /**
  * Assign value to object property .
  * @in_GUID {string} The GUID of the object we want to modify.
  * @in_property {string} The property of the object we want to modify.
  * @in_values {object} The values we are assigning.
  */
  lapi.setObjectParameter = function( in_GUID, in_property, in_values ){
    lapi._embedRPC("ACTIVEAPP.setObjectParameter('" +in_GUID + "'"
      +",{property : '" + in_property + "', value : "
      + JSON.stringify(in_values) + "});",function(in_response){
    });
  };

  /**
   * run a command on the embed – this uses a very limited interface we have...
   * via the message passing interface there is not much that can be done other than
   * call a command by it's name with no real parameters.
   * @private
   */
  lapi._runCommand = function( in_string ){
    lapi._embedRPC( "ACTIVEAPP.runCommand('" + in_string + "')" );
  };

  /**
   * Desselect all selected objects
   */
  lapi.desselectAll = function(){
    lapi._runCommand('DesselectAll');
  };

  /**
   * apply a material to an object by using their guid's
   * @param {String} in_materialGuid
   * @param {String} in_meshGuid
   */
  lapi.applyMaterialToObjectByGuid = function( in_materialGuid, in_meshGuid ){

    var mesh = lapi.getObjectByGuid( in_meshGuid );
    var mat = lapi.getObjectByGuid( in_materialGuid );

    var matParam = mesh.properties.getProperty("Materials").getParameter("Material");
    matParam.value = mat.properties.getParameter("GUID").value;
  };

  /**
   * Apply a material to a mesh by using their names
   * @example lapi.applyMaterialToMeshByName( "Glossy Diffuse", "Sphere" );
   * @param {String} in_materialName
   * @param {String} in_meshName
   */
  lapi.applyMaterialToMeshByName = function( in_materialName, in_meshName ){
    var mesh = lapi.getObjectByName( in_meshName );
    var mat = lapi.getObjectByName( in_materialName );

    var matParam = mesh.properties.getProperty("Materials").getParameter("Material");
    matParam.value = mat.properties.getParameter("GUID").value;
  };


 /**
 * isRendering
 * @returns {Boolean} rendering status
 */
  lapi.isRendering = function(){
    return this._isRendering;
  };

  /**
  * startRender in the embeded scene
  */
  lapi.startRender = function(){
    this._isRendering = true;
    lapi._embedRPC("ACTIVEAPP.StartRender()");
  };

  /**
   * stopRender in the embeded scene
   */
  lapi.stopRender = function(){
    this._isRendering = false;
    lapi._embedRPC("ACTIVEAPP.StopRender()");
  };

  /**
   * Get active camera
   * return {SceneObject} camera
   */
  lapi.getCamera = function(){
    return this._activeCamera;
  };

  /**
   * isPlaying test to know if we are in changing time
   * @return {Boolean} playing status
   */
  lapi.isPlaying = function(){ return this._isPlaying; };

  /**
   * @function stop playing the timeline
   */
  lapi.stop = function(){
    this._isPlaying = false;
    this._frame = 0;
  };

  /**
   * @function start playing the timeline
   */
  lapi.play = function(){

    // abort early
    if (this.isPlaying()) return;

    // start some variables
    var start = null;
    var self = this;
    self._timeIntervalId = null;
    self._isPlaying = true;

    // creat tthe play routine
    function doStep(){
      ++self._frame;
      if (self.isPlaying()) {
        self.stepCb( self._frame );
      }
      else{
        clearInterval(self._timeIntervalId);
      }
    }

    // start play
    var intervalId = setInterval(doStep, 48);
  };

  lapi.nextFrame = function(){
    ++this._frame;
    this.stepCb( this._frame );
  };

  /**
   * @function pause the timeline
   */
  lapi.pause = function(){
    // abort early
    if (this.isPlaying()){
      clearInterval(this._timeIntervalId);
      this._timeIntervalId = null;
    }
  };

  /**
   * method for on Scene Loaded event
   * @virtual
   * @callback called when scene finishes loading – no geometry data is guaranteed to have loaded
   */
  lapi.onSceneLoaded = function(){};

  /**
   * method for stepping to the next frame
   * @virtual
   * @callback called when the animation has to step a frame
   */
  lapi.stepCb = function(){};

  // Make sure that the whole scene is loaded! Only then can you  set the first object selection.
  // This happens because we want the user to have a reference object to guide them.
  $(function() {
    function checkLoaded(){
      console.warn("waiting for scene to load...");
      lapi._embedRPC("ACTIVEAPP.getSceneLoaded();", function(in_response) {
        if (in_response.data === true){
          clearInterval(timer);
          lapi._initialize();
        }
      });
    }
    var timer = setInterval(checkLoaded,3000);
  });

})();
/**
 * @ignore
 * @fileOverview declares the Property api class.
 */

/** A light weight Property object to represent Lagoa Property Sets outside of the embed
 * The goal of this object is to simplify the interaction with the 3D scene by providing
 * a mirror object that takes care of refreshing the scene inside of the embed.
 * @ignore
 * @param {string} in_name name of the property
 * @constructor Property
 */
lapi.Property = function( in_name ){

  /**
   * @dict
   * @private
   */
  this._parameters = {};

  /**
   * @dict
   * @private
   */
  this._properties = {};

  /**
   * @type {string}
   * @private
   */
  this._name = in_name;

};


/**
 * @memberof Property
 */
lapi.Property.prototype = {

  constructor    : lapi.Property,

  /**
   * Accessor to get parameters by name in the Property
   * @function getParameter
   * @param {string} in_param_name the name of the parameter we are looking for
   * @returns {Parameter} object
   */
  getParameter   : function( in_param_name ){ return this.parameters[in_param_name]; },

  /**
   * Add a Parameter object to this Property
   * @param {Parameter} in_parameter object to be added
   */
  addParameter   : function( in_parameter ){ this.parameters[in_parameter.name] = in_parameter; },

  /**
   * Append another property under this property
   * @param {Property} in_property
   */
  appendProperty : function( in_property ){ this.properties[in_property.name] = in_property; },

  /**
   * Get a property by name
   * @param {String} in_property_name the name of the property we are looking for
   * @returns {Property|undefined} the property named with in_property_name,
   * if none is found this returns undefined
   */
  getProperty    : function( in_property_name ){ return this.properties[in_property_name]; },

  /**
   * The name of this Property.
   * trying to change this member will return an error.
   * @type {String}
   */
  get name(){
    return this._name
  },

  /**
   * setter to block change to this variable
   * @private
   */
  set name(in_val){
    console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE );
  },

  /**
   * The dictionary of parameters belonging to this Property.
   * trying to change this member will return an error.
   * @type {Object}
   */
  get parameters(){
    return this._parameters;
  },

  /**
   * setter to block change to this variable
   * @private
   */
  set parameters(in_val){
    console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE );
  },

  /**
   * The dictionary of properties belonging to this Property.
   * trying to change this member will return an error.
   * @type {Object}
   */
  get properties(){
    return this._properties;
  },

  /**
   * setter to block change to this variable
   * @private
   */
  set properties(in_val){
    console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE );
  }
};

/**
 * @ignore
 * @fileOverview declares the parameter api class.
 */

/** @param {lapi.SceneObject} in_ctxtObject the object this parameter belongs to
 * @param {lapi.Property} in_parentProperty the parent Property object
 * @param {object} in_params the input parameters takes name, value, type
 * @constructor Parameter
 */

lapi.Parameter = function( in_ctxtObject, in_parentProperty, in_params ){

  /**
   * @type {string}
   * @private
   */
  var _name  = in_params.name || "";

  /**
   *
   * @type {*|null}
   * @private
   */
  var _value = in_params.value || null;

  /**
   * @type {string|null}
   * @private
   */
  var _type = in_params.type || null;

  /**
   * @type {Property|null}
   * @private
   */
  var _parent = in_parentProperty || null;

  /**
   * @type {SceneObject|null}
   * @private
   */
  var _contextObject = in_ctxtObject || null;

  /**
   * @type {number|null}
   * @private
   */
  var _id = in_params.id || null;

  /**
   * the name of the parameter
   * @type {string}
   * @name name
   * @memberof Parameter
   */
  this.__defineGetter__("name", function(){ return _name; });

  /**
   * setter blocker – blocks member variable from changing, this routine will return an error
   * @params {string}
   */
  this.__defineSetter__("name", function(in_val){ console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE ); });

  /**
   * type getter
   * @returns {string} the type of the parameter
   */
  this.__defineGetter__("type", function(){ return _type; });

  /**
   * setter blocker
   * @params {string} blocks member variable from changing, this routine will return an error
   */
  this.__defineSetter__("type", function(in_val){ console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE ); });

  /**
   * parent getter
   * @returns {string} the parent of the parameter
   */
  this.__defineGetter__("parent", function(){ return _parent; });

  /**
   * setter blocker
   * @params {string} blocks member variable from changing, this routine will return an error
   */
  this.__defineSetter__("parent", function(in_val){ console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE ); });

  /**
   * value getter
   * @returns {number|string|boolean} the value of the parameter
   */
  this.__defineGetter__("value", function(){ return _value; });

  /**
   * value getter
   * @returns {string} the id of the parameter
   */
  this.__defineGetter__("id", function() {return _id;});

  /**
   * setter blocker
   * @params {string} blocks member variable from changing, this routine will return an error
   */
  this.__defineSetter__("id", function(in_val){ console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE ); });

  /**
   * parent setter
   * @returns {string} sets the value of this Parameter, and pushes the change to the Lagoa platform
   */
  this.__defineSetter__("value", function(in_val){
    _value = in_val;
    var paramList = {};
    paramList[ this.id ] = this.value;
    var parentPropName = this.parent.name;
    lapi.setObjectParameter( _contextObject.properties.getParameter("GUID").value, parentPropName, paramList )
  })

};


/**
 * @memberof Parameter
 */
lapi.Parameter.prototype = {
  constructor : lapi.Parameter
};

/**
 * @ignore
 * @fileOverview Implements the SceneObject api class.
 */

/** A object to handle and represent a Lagoa SceneObject outside of the platform
 * This object will be initialized – based on the input guid – producing a
 * mirror object locally outside of the embed.
 * @param {string} in_guid guid of an object in the scene
 * @class SceneObject
 */
lapi.SceneObject = function( in_guid ){
  var _guid = in_guid;
  var _properties = {};
  var _self = this;

  /**
   * Get the property of the SceneObject
   * @type {Property}
   */
  this.__defineGetter__("properties", function(){
    return _properties;
  });

  /**
   * @method setter block access to changing the reference
   * to the properties object represented by this SceneObject
   */
  this.__defineSetter__("properties", function(in_val){
    console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE );
  });

  /**
   * @member {string} guid of this object
   */
  this.__defineGetter__("guid", function(){
    return _guid;
  });

  /**
   * @member {string} setter that blocks changing the guid of this object
   */
  this.__defineSetter__("guid", function(in_val){
    console.error( lapi.CONSTANTS.CONSOLE_MSGS.IMMUTABLE );
  });

  // We cache the entire PropertySet object (flattened) for local access
  // The deep copy routine builds the embed object using the local property and parameter objects
  console.warn("Building PSet of " + in_guid );
  lapi._embedRPC("ACTIVEAPP.GetScene().GetByGUID('"+in_guid+"').PropertySet.flatten()",
    function(in_embedRPC_message){
      if( !(in_embedRPC_message.error === "EXECERR") ){
        var pSet = in_embedRPC_message.data;
        _properties = _self._pSetDeepCopy( _self, pSet );
      }
    }
  );

};

/**
 * @memberof SceneObject
 */
lapi.SceneObject.prototype = {

  constructor : lapi.SceneObject,

  /**
   * Get the material applied to this SceneObject if any.
   * @returns {SceneObject}
   */
  getMaterial : function(){
    var matGuid = this.properties.getProperty("Materials").getParameter("Material").value;
    return lapi.getActiveScene().getObjectByGuid( matGuid );
  },

  /**
   * a shortcut to get a property under properties
   * @param in_propName
   * @returns {*|Property|undefined}
   */
  getProperty : function( in_propName ){
    return this.properties.getProperty( in_propName );
  },

  /**
   * copy a PropertySet that is returned via an embedRPC call. The returned object is
   * parsed into a local object made out of SceneObject, Property and Parameter classes.
   * @in_ctxtObject {SceneObject} the object this pset belongs to
   * @in_pset {object} the propertySet object returned from an lapi._embedRPC call
   * @private
   */
  _pSetDeepCopy : function( in_ctxtObject, in_pset ){

    var rtn = new lapi.Property("PropertySet");

    var diveIn = function( in_prop, in_rtn ){
      for( var i in in_prop ){
        if(in_prop[i].name){                                                // it is a parameter
          in_rtn.addParameter( new lapi.Parameter( in_ctxtObject, in_rtn, in_prop[i] ));
        }else{
          var newProp = new lapi.Property(i);
          in_rtn.appendProperty( newProp );                              // it is a property
          diveIn(in_prop[i], newProp );
        }
      }
    };

    diveIn(in_pset, rtn);

    return rtn;
  }

};

/**
 * @ignore
 * @fileOverview Declares the utils namespace
 */

/**
 * @namespace lapi.utils
 */
lapi.utils = {

  objToArray : function(in_Obj){

    var rtn = [];

    for(var i in in_Obj){
      rtn.push(in_Obj[i]);
    }

    return rtn;
  },

  /**
   * RGB to HEX color conversion
   * @param {Number} r red value from 0-255 range
   * @param {Number} g green value from 0-255 range
   * @param {Number} b blue value from 0-255 range
   * @example rgbToHEX(255, 125, 65); //returns "FF7D41"
   * @returns {String}
   */
  rgbToHEX : function(r, g, b) {
    var hex = [
      r.toString( 16 ),
      g.toString( 16 ),
      b.toString( 16 )
    ];
    $.each( hex, function( nr, val ) {
      if ( val.length === 1 ) {
        hex[ nr ] = "0" + val;
      }
    });
    return hex.join( "" ).toUpperCase();
  },

  /**
   * HEX to RGB color conversion
   * @param hex
   * @returns {{r: Number, g: Number, b: Number}}
   */
  hexToRGB : function(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }
};

/**
 * @ignore
 * @fileOverview declares the Scene api class.
 */

/** flat Scene representation organized by object kind (Light, Material, Mesh, etc...)
 * @param {object} in_guidList is expected to be { classID : [ Array ] }
 * @constructor Scene
 */
lapi.Scene = function( in_sceneGuid, in_guidList ){

  // this is just so we keep track of the guid of the scene here.
  this._guid = in_sceneGuid;

  // organize by class
  this._classedItems = {};

  // the guid list for search
  this._guidItems = {};


  for( var i in in_guidList ){

    var tmpGuid;

    var classID = in_guidList[i];

    // create a hash of the classed type
    var initClass = this._classedItems[i] = {};

    // build the shallow SceneObject in place
    for( var j in classID){
      tmpGuid = classID[j];
      this._guidItems[tmpGuid] = initClass[tmpGuid] = new lapi.SceneObject( tmpGuid );
    }
  }
};

/**
 * @memberof Scene
 */
lapi.Scene.prototype = {
  constructor    : lapi.Scene,

  /**
   * Get an object via it's guid
   * @param in_guid
   * @returns {String}
   */
  getObjectByGuid : function( in_guid ){
    return this._guidItems[ in_guid ];
  },

  getObjectByName : function( in_name ){
    var find = [];
    var sceneObjs = this._guidItems;
    var o;

    for( var i in sceneObjs){
      o = sceneObjs[i];
      if( in_name === o.properties.getParameter("Name").value ){
        find.push(o);
      }
    }
    return find;
  },

  getLights : function(){
    return lapi.utils.objToArray(this._classedItems[ lapi.CONSTANTS.SCENE.LIGHT ] );
  },

  getCameras : function(){
    return lapi.utils.objToArray(this._classedItems[ lapi.CONSTANTS.SCENE.CAMERA ]);
  },

  getMeshes : function(){
    return lapi.utils.objToArray(this._classedItems[ lapi.CONSTANTS.SCENE.MESH ]);
  },

  getMaterials : function(){
    return lapi.utils.objToArray(this._classedItems[ lapi.CONSTANTS.SCENE.MATERIAL ]);
  },

  getTextures : function(){
    return lapi.utils.objToArray(this._classedItems[ lapi.CONSTANTS.SCENE.TEXTURE ]);
  },

  getGroups : function(){
    return lapi.utils.objToArray(this._classedItems[ lapi.CONSTANTS.SCENE.GROUP ]);
  }

};