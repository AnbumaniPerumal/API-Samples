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