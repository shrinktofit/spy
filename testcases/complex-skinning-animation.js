(() => {
  const { cc, app, dgui } = window;
  const { resl } = cc;

  let dobj = {
    baseUrl: '../assets/out',
    scene: 'spec-skeleton',
    entityPath: 'Hero',
    animationclips: [],
    use2DMotion: true,
    movementSpeed: 0.0,
    movementSpeedX: 0.0,
    movementSpeedZ: 0.0,
    isHealth: true,
  };

  dgui.remember(dobj);
  dgui.add(dobj, 'baseUrl').name("Base URL").onFinishChange(() => load());
  dgui.add(dobj, 'scene').name("Scene").onFinishChange(() => load());
  dgui.add(dobj, 'entityPath').name("Entity path");

  load();

  class WanderComponent extends cc.Component {
    constructor() {
      super();
      this._blender = null;
    }

    onInit() {
      this._system.add(this);

      /**
       * The character's normalized tranlating velocity.
       * @type {vec2}
       */
      this._destMoveVelocity = cc.math.vec2.zero();

      /**
       * The character's speed.
       * @type {Number}
       */
      this._destSpeed = 0;

      /**
       * The circle area center on which the character can move.
       * @type {vec2}
       */
      this._activityCenter = new cc.math.vec2(this._entity.lpos.x, this._entity.lpos.z);

      /**
       * The circle area radius on which the character can move.
       * @type {Number}
       */
      this._activityRadius = 5;

      /**
       * Indicates whether next '_changeVelocity' should let character's speed become 0.
       * @type {Boolean}
       */
      this._shouldIdle = true;

      /**
       * The time counter that the character's speed keeps for.
       * @type {Number}
       */
      this._moveTime = 0;

      /**
       * The velocity argument passed to blender is not varied immediately.
       * Instead, it will be blended with last velocity argument as time goes by.
       * @type {Number}
       */
      this._speedFadeTime = 0.5;

      /**
       * _velocityFadeTime's time counter.
       * @type {Number}
       */
      this._speedFadeTimeCounter = this._speedFadeTime;

      /**
       * Last speed.
       * @type {vec2}
       */
      this._lastSpeed = 0;

      /**
       * Destination position that the character would arrived next.
       * @type {?vec2}
       */
      this._destPos = null;

      this._rotationSpeed = 45.0;
      //this._rotationSpeed = 0.0;

      this._lastPos = null;

      this._lastRotAngle = 0.0;

      this._rotAngle = 0.0;

      this._nextRotatingStartTime = 0.0;

      this._isRotating = false;

      this._lastBlenderVelocity = null;
    }

    onDestroy() {
      this._system.remove(this);
    }

    set blender(blender) {
      this._blender = blender;
    }

    set maxRotateTime(time) {
      this._maxRotateTime = time;
    }

    update(deltaTimeSec) {
      if (this._isRotating) {
        if (this._rotateTime <= 0) {
          this._isRotating = false;
          this._nextRotatingStartTime = cc.math.randomRange(1.0, 3.0);
        }
        else {
          this._rotateTime -= deltaTimeSec;
          let dAngle = this._rotationSpeed * deltaTimeSec;
          this._lastRotAngle = this._rotAngle;
          this._rotAngle += dAngle;
          let lrot = this._entity.lrot;
          cc.math.quat.rotateY(lrot, lrot, cc.math.toRadian(dAngle));
        }
      }
      else if (this._nextRotatingStartTime > 0)
        this._nextRotatingStartTime -= deltaTimeSec;
      else {
        this._isRotating = true;
        this._rotateTime = cc.math.randomRange(0.0, 4.0);
        this._rotationSpeed = Math.random() > 0.5 ? -this._rotationSpeed : this._rotationSpeed;
      }

      // We interpolate the speed to accuqire a smooth result.
      this._speedFadeTimeCounter += deltaTimeSec;
      let speedFadeCoff = cc.math.clamp(this._speedFadeTimeCounter / this._speedFadeTime, 0, 1);
      let speed = this._lastSpeed * (1 - speedFadeCoff) + this._destSpeed * speedFadeCoff;

      // Move the character.
      if (this._moveTime <= 0) {
        this._changeVelocity();
        return;
      }
      else { // Update character's position.
        this._moveTime -= deltaTimeSec;
        let dmove = speed * deltaTimeSec;
        let realdmove = dmove;
        let offsetVelocity = new cc.math.vec3(this._destMoveVelocity.x, 0, this._destMoveVelocity.y);
        cc.math.vec3.scaleAndAdd(this._entity.lpos, this._entity.lpos, offsetVelocity, realdmove);
      }

      // Set the blend result.
      let pos = cc.math.vec3.zero();
      this._entity.getWorldPos(pos);
      if (this._lastPos == null)
        this._lastPos = cc.math.vec3.clone(pos);
      let moveVelocity3D = cc.math.vec3.zero();
      cc.math.vec3.sub(moveVelocity3D, pos, this._lastPos);
      cc.math.vec3.normalize(moveVelocity3D, moveVelocity3D);
      let lastRot = cc.math.quat.create();
      // We should neg the angle.
      // Since the character is rotated by n degree,
      // then the character need rotate n degrees back
      // then perform the move direction that originally supposed no rotation applied.
      // That is to say the move direction becomes larger.
      cc.math.quat.rotateY(lastRot, lastRot, cc.math.toRadian(-this._lastRotAngle));
      let faceVelocity3D = cc.math.vec3.zero();
      cc.math.vec3.transformQuat(faceVelocity3D, moveVelocity3D, lastRot);
      let blenderVelocity = new cc.math.vec2(faceVelocity3D.x * speed, faceVelocity3D.z * speed);
      this._setBlenderVelocity(blenderVelocity);

      cc.math.vec3.copy(this._lastPos, pos);
      this._lastRotAngle = this._rotAngle;
    }

    _setBlenderVelocity(blenderVelocity) {
      if (this._lastBlenderVelocity == null)
        this._lastBlenderVelocity = cc.math.vec2.clone(blenderVelocity);
      else if (cc.math.vec2.equals(this._lastBlenderVelocity, blenderVelocity))
        return;
      cc.math.vec2.copy(this._lastBlenderVelocity, blenderVelocity);
      this._blender.setInput(blenderVelocity);
      //console.log(`${blenderVelocity.x}, ${blenderVelocity.y}`);
    }

    _changeVelocity() {
      this._lastSpeed = this._destSpeed;

      this._moveTime = cc.math.randomRange(1.0, 7.0);
      if (this._shouldIdle) {
        // Keep the _destMoveVelocity unchangedly.
        this._destSpeed = 0;
      }
      else {
        let lastPos = new cc.math.vec2(this._entity.lpos.x, this._entity.lpos.z);
        let angle = cc.math.randomRange(0, Math.PI * 2);
        this._destPos = new cc.math.vec2(
          this._activityCenter.x + Math.cos(angle) * this._activityRadius,
          this._activityCenter.y + Math.sin(angle) * this._activityRadius);
        cc.math.vec2.sub(this._destMoveVelocity, this._destPos, lastPos);
        // Generate the new move velocity.
        cc.math.vec2.normalize(this._destMoveVelocity, this._destMoveVelocity);
        this._destSpeed = cc.math.randomRange(1.0, 2.8);
      }

      this._speedFadeTimeCounter = 0;
      this._shouldIdle = !this._shouldIdle;
    }

    distanceToDestination() {
      return cc.math.vec2.distance(new cc.math.vec2(this._entity.lpos.x, this._entity.lpos.z), this._destPos);
    }
  }

  class WanderSystem extends cc.System {
    constructor() {
      super();
      this._thiscomps = new cc.memop.FixedArray(200);
    }

    add(comp) {
      this._thiscomps.push(comp);
    }

    remove(comp) {
      this._thiscomps.fastRemove(this._thiscomps.indexOf(comp));
    }

    tick() {
      for (let i = 0; i < this._thiscomps.length; ++i) {
        let thiscomp = this._thiscomps.data[i];
        thiscomp.update(this._app.deltaTime);
      }
    }
  }

  function load() {
    resl({
      manifest: {
        gameInfo: {
          type: 'text',
          parser: JSON.parse,
          src: `${dobj.baseUrl}/game.json`
        }
      },

      onDone(data) {
        app.loadGameConfig(`${dobj.baseUrl}`, data.gameInfo);
        app.assets.loadLevel(`${dobj.scene}`, (err, level) => {
          if (err) {
            console.error(err);
          } else {
            app.loadLevel(level);

            app.registerClass("WanderComponent", WanderComponent);
            app.registerSystem("WanderSystem", WanderSystem, "WanderComponent", 0);

            let charFolder = dgui.addFolder("Character");

            let mainEntity = app.find(dobj.entityPath);
            let mainEntityComplexAnimation = mainEntity.addComp('ComplexAnimation');
            let mainEntityAnimation = mainEntity.getComp('Animation');
            let animationGraph = mainEntityComplexAnimation.animationGraph;

            let clips = [];
            for (let clip of mainEntityAnimation.clips)
              clips.push(clip.name);
            charFolder.add(dobj, 'animationclips', clips).name("Clips").onFinishChange((value) => {
              mainEntityAnimation.play(value);
            });

            let getClip = (clipName) => mainEntityAnimation.getState(clipName).clip;

            let blender1D = null, movementMotion1D = null;
            let blender2D = null, movementMotion2D = null;

            { // Setup 1D movement motion.
              blender1D = new cc.animation.AnimationBlender1D();
              blender1D.setSamples([
                new cc.animation.BlendItem1D(getClip("Idle"), 0),
                new cc.animation.BlendItem1D(getClip("WalkForward"), 1),
                new cc.animation.BlendItem1D(getClip("RunForward"), 2),
              ]);
              let blendTree = new cc.animation.BlendTree(blender1D);

              movementMotion1D = new cc.animation.Motion("Movement 1D", blendTree);
              animationGraph.addMotion(movementMotion1D);
            }

            { // Setup 2D movement motion.
              blender2D = new cc.animation.AnimationBlender2D();
              blender2D.setSamples([
                new cc.animation.BlendItem2D(getClip("Idle1"), new cc.math.vec2(0, 0)),
                new cc.animation.BlendItem2D(getClip("WalkForward"), new cc.math.vec2(-0.005572557, -0.6971362)),
                new cc.animation.BlendItem2D(getClip("RunForward"), new cc.math.vec2(-0.02778556, -2.791705)),
                new cc.animation.BlendItem2D(getClip("WalkBackward"), new cc.math.vec2(0.06017925, 1.171192)),
                new cc.animation.BlendItem2D(getClip("RunBackward"), new cc.math.vec2(-0.05457803, 2.63343)),
                new cc.animation.BlendItem2D(getClip("WalkStrafeLeft"), new cc.math.vec2(-1.04923, 0.007108632)),
                new cc.animation.BlendItem2D(getClip("RunStrafeLeft"), new cc.math.vec2(-1.91469, -0.03539196)),
                new cc.animation.BlendItem2D(getClip("WalkStrafeRight"), new cc.math.vec2(1.27831, -0.01445141)),
                new cc.animation.BlendItem2D(getClip("RunStrafeRight"), new cc.math.vec2(1.869793, -0.0276596)),
              ]);
              let blendTree = new cc.animation.BlendTree(blender2D);

              movementMotion2D = new cc.animation.Motion("Movement 2D", blendTree);
              animationGraph.addMotion(movementMotion2D);
            }

            let wanderComponent = mainEntity.addComp("WanderComponent");
            wanderComponent.blender = blender2D;
            wanderComponent.maxRotateTime = getClip("IdleWalk").length;
            let turnAroundMotion = new cc.animation.Motion("Turn around", getClip("IdleWalk"));
            animationGraph.addMotion(turnAroundMotion);

            let onUse2DMotionChanged = () => {
              if (dobj.use2DMotion)
                animationGraph.linearSwitch(movementMotion2D);
              else
                animationGraph.linearSwitch(movementMotion1D);
            };
            charFolder.add(dobj, "use2DMotion", true).name("Use 2D Motion").onChange(onUse2DMotionChanged);

            charFolder.add(dobj, "movementSpeed", 0.0, 2.0).name("Speed(1D)").onFinishChange((value) => {
              blender1D.setInput(value);
            });
            charFolder.add(dobj, "movementSpeedX", -3.0, 3.0).name("Speed(2D) X").onFinishChange(() => {
              blender2D.setInput(new cc.math.vec2(dobj.movementSpeedX, dobj.movementSpeedZ));
            });
            charFolder.add(dobj, "movementSpeedZ", -3.0, 3.0).name("Speed(2D) Z").onFinishChange(() => {
              blender2D.setInput(new cc.math.vec2(dobj.movementSpeedX, dobj.movementSpeedZ));
            });

            onUse2DMotionChanged();

            // Death motion is just a single animation clip.
            let deathMotion = new cc.animation.Motion("Death", getClip("ShootDown"));
            deathMotion.wrapMode = 'once';
            animationGraph.addMotion(deathMotion);

            // Setup the transitions between these motions.
            // The "isHealth" parameter with type boolean is used to indicate whether
            // the character is health. Is so, let it doing the movement motion, death motion instead. 
            let isHealth = animationGraph.createParameter("IsHealth", "boolean");
            isHealth.value = true; // By default, the character is health.
            let death = movementMotion2D.makeTransitionTo(deathMotion);
            death.addCondition(new cc.animation.Condition(isHealth, 'equal', false));
            let reborn = deathMotion.makeTransitionTo(movementMotion2D);
            reborn.addCondition(new cc.animation.Condition(isHealth, 'equal', true));

            charFolder.add(dobj, "isHealth", true).name("Health").onFinishChange((value) => {
              isHealth.value = value;
            });
          }
        });

      }
    });
  }
})();