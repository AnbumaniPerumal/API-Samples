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
