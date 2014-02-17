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
    PROJECTION : "TextureProjectionID",
    STATES : "StateID"
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
   * @type {Object}
   * @private
   */
  lapi._eventCbMap = {};

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
   * method for on Object Added event
   * @virtual
   * @callback called when object has been added to the scene. Expects the SceneObject that has jus been added;
   */

   lapi.onObjectAdded = function(){};

  /**
   * Implements the MPI interface to receive messages back from the lagoa embed
   * @private
   */
  window.addEventListener("message", function(e){
    var retval = JSON.parse(e.data);
    if(retval.channel == 'rpcend') {

//      console.warn("returning RPC call", lapi._cbStack);
//      --lapi._cbStack;
      if (retval.subchannel) {
        if(retval.subchannel === 'objectAdded'){
          var scn = lapi.getActiveScene();
          var tuid = retval.data.tuid;
          scn.addObject(tuid,retval.data.guid, function(obj){
            var guid = obj.properties.getParameter('guid').value;
            if(lapi._cbmap[guid]){
              var callback = lapi._cbmap[guid];
              callback(obj);
              delete lapi._cbmap[guid];
            }
            lapi.onObjectAdded(obj);
          });
        }
      } else {
        if(lapi._cbmap[retval.id]){
          var callback = lapi._cbmap[retval.id];
          callback(retval);
          delete lapi._cbmap[retval.id];
        }
        else if(lapi._eventCbMap[retval.id]){
          var cbArray = lapi._eventCbMap[retval.id];
          for(var i = 0 ; i < cbArray.length; ++i){
            cbArray[i](retval.data);
          }
        }
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
   * Pass messgage to SC
   * @in_message {object} message we will stringify and send to SC
   */
  lapi._messageIframe = function(in_message){
    var iframe = document.getElementById('lagoaframe');
    iframe.contentWindow.postMessage(JSON.stringify(in_message), '*');
  };

  /**
   * RPC call for SC to execute.
   * @message {string} instructions we want to execute
   * @callback {function} Optional callback. It will use whatever the RPC call returns. Note, that RPC
   * return value is a stringified object we parse. It's not returning a proxy or the actual object.
   * Interactions with the scene will happen only through embedRPC calls.
   */
  lapi._embedRPC = function(message, callback){
    var randName = 'xxxxxxxxxx'.replace(/x/g,function(){return Math.floor(Math.random()*16).toString(16)});
    if(callback){
      lapi._cbmap[randName] = callback;
    }
    lapi._messageIframe({channel : 'embedrpc', id: randName, command : message});
  };

  /**
   * Active scene loaded in the embed
   * @type {lapi.Scene}
   * @private
   */
  lapi._activeScene = null;

  /**
   * accessor to return the current loaded scene
   * @returns {lapi.Scene}
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

  /*
   * Load assets dynamically into the scene.
   * @in_assetArray {Array} a collection of assets we want to load.
   * Each member is an object of the type {name : {string}, datatype : {number} , version_guid : {string}}.
   * After the loading is done, the scene object is re-initialized.
   * ex : lapi._loadAssets([{name : 'UntitledScene',datatype : 14, version_guid : '5fee03c9-8985-42fa-a4aa-a5689c6ab7e9'}]);
   * @private
   */
  lapi._loadAssets = function(in_assetArray){
    var objectCount = this._activeScene.getObjectCount();
    lapi._embedRPC("ACTIVEAPP.LoadAssets({ " +
      "assets :" +
        JSON.stringify(in_assetArray)+
      "});");
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

    var scn = lapi.getActiveScene();

    var mesh = scn.getObjectByGuid( in_meshGuid );
    var mat = scn.getObjectByGuid( in_materialGuid );

    var matParam = mesh.properties.getProperty("Materials").getParameter("tmaterial");
    matParam.value = mat.properties.getParameter("guid").value;
  };

  /**
   * Apply a material to a mesh by using their names
   * @example lapi.applyMaterialToMeshByName( "Glossy Diffuse", "Sphere" );
   * @param {String} in_materialName
   * @param {String} in_meshName
   */
  lapi.applyMaterialToMeshByName = function( in_materialName, in_meshName ){

    var scn = lapi.getActiveScene();

    var mesh = scn.getObjectByName( in_meshName )[0];
    var mat = scn.getObjectByName( in_materialName )[0];

    var matParam = mesh.properties.getProperty("Materials").getParameter("tmaterial");
    matParam.value = mat.properties.getParameter("guid").value;
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
   * Set the camera resolution parameters to in_Params.width and in_Params.height, if either is missing
   * the current value is preserved.
   * @param in_Params {Object} containing two members, width{Number} and height{Number}
   * TODO move this routine into a specialized camera class
   */
  lapi.setCameraResolution = function( in_Params ){

    // get the camera and the resolution property
    var cam = lapi.getCamera();
    var camGuid = cam.properties.getParameter("guid").value;

    var resProp = cam.getProperty("Resolution");

    // validate we have some decent parameters to work with or default to what is already set to
    in_Params.width  = "width"  in in_Params ? in_Params.width  : resProp.parameters.width.value;
    in_Params.height = "height" in in_Params ? in_Params.height : resProp.parameters.height.value;

    // set once
    lapi.setObjectParameter(
      camGuid, 'Resolution',
      { width  : in_Params.width,
        height : in_Params.height }
    );
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
  lapi.play = function(in_fps){

    in_fps = Math.round(1000/in_fps) || Math.round(1000/30) ; // ~30fps is the default

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
    var intervalId = setInterval(doStep, in_fps);
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

  lapi.moveTool = function(){
    lapi._embedRPC("ACTIVEAPP.Tools.setActiveTool('MoveTool');")
  };

  lapi.scaleTool = function(){
    lapi._embedRPC("ACTIVEAPP.Tools.setActiveTool('ScaleTool');")
  };

  lapi.orbitTool = function(){
    lapi._embedRPC("ACTIVEAPP.Tools.setActiveTool('OrbitTool');")
  };

  lapi.panTool = function(){
    lapi._embedRPC("ACTIVEAPP.Tools.setActiveTool('PanTool');")
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
//      console.warn("waiting for scene to load...");
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
   * @type {lapi.Parameter}
   * @private
   */
  this._parameters = {};

  /**
   * Name lookup for search by name
   * @type {lapi.Parameter}
   * @private
   */
  this._parametersByName = {};

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

  constructor : lapi.Property,

  /**
   * Accessor to get parameters by ID in this Property
   * @function getParameter
   * @param {string} in_param_id the name of the parameter we are looking for
   * @returns {Parameter} object
   */
  getParameter : function( in_param_id ){
    return this.parameters[in_param_id];
  },

  /**
   * Add a Parameter object to this Property
   * @param {Parameter} in_parameter object to be added
   */
  addParameter   : function( in_parameter ){
    this.parameters[in_parameter.id] = in_parameter;
    this._parametersByName[in_parameter.name] = in_parameter;
  },

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
    lapi.setObjectParameter( _contextObject.properties.getParameter("guid").value, parentPropName, paramList )
  })

};


/**
 * @memberof Parameter
 */
lapi.Parameter.prototype = {
  constructor : lapi.Parameter,

  /**
   * Set the value of this parameter without updating the back-end
   * @private
   */
  _setValueMuted : function(in_val){
    this._value = in_val;
  }
};

/**
 * @ignore
 * @fileOverview Implements the SceneObject api class.
 */

/** A object to handle and represent a Lagoa SceneObject outside of the platform
 * This object will be initialized – based on the input guid – producing a
 * mirror object locally outside of the embed.
 * @param {string} in_guid guid of an object in the scene
 * @param {function} in_cb (optional) callback is called when object is done initializing.
 * The callback expects an SceneObject.
 * @class SceneObject
 */
lapi.SceneObject = function( in_guid, in_cb){
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
  lapi._embedRPC("ACTIVEAPP.GetScene().GetByGUID('"+in_guid+"').PropertySet.flatten({"
    +   "flattenType: Application.CONSTANTS.FLATTEN_PARAMETER_TYPE.VALUE_ID"
    + "});",
    function(in_embedRPC_message){
      if( !(in_embedRPC_message.error === "EXECERR") ){
        var pSet = in_embedRPC_message.data;
        _properties = _self._pSetDeepCopy( _self, pSet );
        if(in_cb){
          in_cb(_self);
        }
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
    var matGuid = this.properties.getProperty("Materials").getParameter("tmaterial").value;
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
   * RPC call for SC to execute. It will bind our callbacks to the object's modifications.
   * As a bonus, we will now automatically track the values of the property parameters and update our object
   * accordingly. This way, the user won't be responsible for the updating/tracking!
   * @in_propName {string} The property of the object we want to track.
   * @callback {function} Optional callback. It will use a stringified property object or
   * a paramater. Note : property objects is made of key-value entries, where the key is a
   * parameter id and value is a strigified parameter. The exception being if a property is
   * a single parameter. Then, it's just the parameter object itself.  
   */
  bindProperty : function( in_propName, callback){
    var eventName = this.guid + ':' + in_propName;
    var initialBind = false;
    if(!lapi._eventCbMap[eventName]){
      initialBind = true;
      var cb;
      var property = this.getProperty(in_propName);
      if(property){
        cb = function(data){
          for( var i in data){
            property.getParameter(i)._setValueMuted(data[i].value);
          }
        };
      }else {
        property = this.properties.getParameter(in_propName);
        cb = function(data){
          property._setValueMuted(data.value);
        };

      }
      lapi._eventCbMap[eventName] = [cb];
    }
    if(callback){
      lapi._eventCbMap[eventName].push(callback);
    }
    if(initialBind){
      lapi._messageIframe({channel : 'embedrpc', id: eventName});
    }
  },

  /**
   * RPC call for SC to execute. It will unbind all callbacks from specific object's modifications.
   * This also means we are no longer tracking the object values.
   * @in_propName {string} The property of the object we want to track.
   */
  unbindProperty : function( in_propName){
    var eventName = this.guid + ':' + in_propName;
    if(!lapi._eventCbMap[eventName]){
      return;
    }
    delete lapi._eventCbMap[eventName];
    lapi._messageIframe({channel : 'embedrpc', id: eventName, unbind : true});
  },

  /**
   * This will unbind a specific callback from the object's property modifications.
   * @in_propName {string} The property of the object we want to track.
   * @callback {function}  The callback we want to unbind.
   */
  unbindPropertyCb : function( in_propName, callback){
    var eventName = this.guid + ':' + in_propName;
    if(!lapi._eventCbMap[eventName]){
      return;
    }
    var index = lapi._eventCbMap[eventName].indexOf(callback);
    if (index > -1) {
      lapi._eventCbMap[eventName].splice(index, 1);
    }
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
        if( in_prop[i].id && in_prop[i].type ){  // if it has an ID and a TYPE then it is a parameter object...
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
  },

  /**
   * This is an asynchronous function!
   * Compute the BoundingBox of an object in world space. In other words, take into
   * account the translation,rotation and scale components.
   * @in_cb {function} function that expects an object  {min : {x : v, y : v, z :v}, max :{...}}
   * the 'v' is a stand-in for numerical values.
   */
  computeTransformedAABB : function(in_cb){
    var bb = this.properties.getProperty("BoundingBoxMin");
    if(!bb){
      console.warn('object has no bounding box');
      return;
    }
    lapi._embedRPC("var obj = ACTIVEAPP.GetScene().GetByGUID('" + this.guid +"');"
      + "var bbox = ACTIVEAPP.boundingBoxForEntity(obj);"
      + "bbox.transformAndAxisAlign(obj.matrix);",function(in_response){
        in_cb(in_response.data);
      });
  },

  /**
   * This is an asynchronous function!
   * If this is an object with children, return an array of their guids!
   * @in_cb {function} function that expects an array of guids
   */
  fetchChildren : function(in_cb){
    lapi._embedRPC("var obj = ACTIVEAPP.GetScene().GetByGUID('" + this.guid +"');"
      + "var arr = [];"
      + "if (obj._children) { "
      + " for (var i = 0 ; i < obj._children.length; ++i) {"
      +  "  arr[i] = obj._children[i].guid; "
      +  "}"
      + "}"
      + "arr",function(in_response){
        in_cb(in_response.data);
      });
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

  // the scene object count
  this._objectCount = 0;


  for( var i in in_guidList ){

    var tmpGuid;

    var classID = in_guidList[i];

    // create a hash of the classed type
    var initClass = this._classedItems[i] = {};

    // build the shallow SceneObject in place
    for( var j in classID){
      tmpGuid = classID[j];
      this._guidItems[tmpGuid] = initClass[tmpGuid] = new lapi.SceneObject( tmpGuid );
      ++this._objectCount;
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
      if( in_name === o.properties.getParameter("name").value ){
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
  },

  getStates : function(){
    return lapi.utils.objToArray(this._classedItems[ lapi.CONSTANTS.SCENE.STATES ]);
  },

  getObjectCount : function(){
    return this._objectCount;
  },

  addAssets : function(in_assetArray){
    lapi._loadAssets(in_assetArray);
  },

  /*
   * Load a 2D asset dynamically into the scene. 
   * @in_guid {String} The guid of the asset we want to load
   * @in_dataType {Number} The datatype of the asset
   * @in_name {String} name of the asset. Can be user-defined.
   * @in_cb {Function} optional callback that expects the SceneObject of the asset just added.
   */
  addAsset2D : function(in_guid, in_dataType, in_name, in_cb){
    var scn = lapi.getActiveScene();
    var obj = scn.getObjectByGuid(in_guid);
    if(obj){
      console.warn("Asset already added to scene.");
      return;
    }
    if(in_cb){
      lapi._cbmap[in_guid] = in_cb;
    }
    lapi._loadAssets([{name : in_name, datatype : in_dataType, version_guid : in_guid}]);
  },

  addObject : function(in_tuid,in_guid,in_cb){
    var initClass = this._classedItems[in_tuid];
    if(!initClass){
      initClass = this._classedItems[in_tuid] = {};
    }
    this._guidItems[in_guid] = initClass[in_guid] = new lapi.SceneObject( in_guid,in_cb);
    ++this._objectCount;
  },

  /**
   * Add a new material to scene.
   * @param {string} in_materialType  The type of material the user wants to add : 'Glossy Diffuse','Architectural Glass' etc.
   * @param {function} in_cb  optional callback that expects a material SceneObject as an argument. The object is the one we just added
   * to the scene through addNewMaterial().
   */
  addNewMaterial : function(in_materialType,in_cb){
    var self = this;
    lapi._embedRPC("var mat = ACTIVEAPP.AddEngineMaterial({minortype : '"
    + in_materialType + "'});"
    + "mat.guid;",function(in_response){
      if(in_cb){
        lapi._cbmap[in_response.data] = in_cb;
      }
    });
  },

  /**
   * Add a new light to scene.
   * @param {string} in_lightType  The type of light the user wants to add : 'DomeLight','SunSkyLight' etc.
   * @param {function} in_cb  optional callback that expects a light SceneObject as an argument. The object is the 
   * one we just added to the scene through addNewLight().
   */
  addNewLight : function(in_lightType,in_cb){
    var self = this;
    lapi._embedRPC("var light = ACTIVEAPP.AddLight({minortype : '"
    + in_lightType + "'});"
    + "light.guid;",function(in_response){
      if(in_cb){
        lapi._cbmap[in_response.data] = in_cb;
      }
    });
  }

};
