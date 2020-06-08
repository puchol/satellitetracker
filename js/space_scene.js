let cameraState = 0;

let sunGroup = new THREE.Object3D();
let earthGroup = new THREE.Object3D();
let centerGroup = new THREE.Object3D();
let issGroup = new THREE.Object3D();

let iss = null;
let earth = null;
let atmosphere = null;
let issLabel = null;

function createSpaceScene(camera) {
    // Create space scene
    const scene = new THREE.Scene();

    // Bindings
    scene.add(centerGroup);
    earthGroup.add(sunGroup)
    centerGroup.add(earthGroup);
    earthGroup.add(issGroup);

    // Ambient Light
    const light = new THREE.AmbientLight(0x888888, debug ? 3.2 : 0.2);
    scene.add(light);

    // Sun
    const reflectionLight = new THREE.DirectionalLight(0xffffff, 2.0);
    sunGroup.add(reflectionLight);

    // Earth
    const earthGeometry = new THREE.SphereBufferGeometry(EARTH_RADIUS, 32, 32);
    const earthMaterial = new THREE.MeshPhongMaterial({color: 0xffffff});
    earth = new THREE.Mesh(earthGeometry, earthMaterial);
    earthMaterial.map = THREE.ImageUtils.loadTexture('assets/img/earth_map.jpg');
    earthMaterial.map.minFilter = THREE.LinearFilter;
    earthMaterial.bumpMap = THREE.ImageUtils.loadTexture('assets/img/earth_bump.jpg');
    earthMaterial.specularMap = THREE.ImageUtils.loadTexture('assets/img/earth_spec.jpg');
    earthMaterial.specular = new THREE.Color(0x050505);
    earthMaterial.shininess = 10;
    earth.castShadow = true;
    earth.receiveShadow = true;
    earthGroup.add(earth);

    // Atmosphere
    const atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS + ATMOSPHERE_HEIGHT, 256, 256)
    createAtmosphereMaterial(function (atmosphereMaterial) {
        atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        atmosphere.castShadow = true;
        atmosphere.receiveShadow = true;
        centerGroup.add(atmosphere);
    });

    // Stars
    const starsGeometry = new THREE.SphereBufferGeometry(EARTH_RADIUS * 3, 32, 32);
    const starsMaterial = new THREE.MeshBasicMaterial();
    const stars = new THREE.Mesh(starsGeometry, starsMaterial);
    starsMaterial.map = THREE.ImageUtils.loadTexture('assets/img/galaxy_starfield.png');
    starsMaterial.side = THREE.BackSide;
    centerGroup.add(stars);

    // ISS
    const loader = new THREE.GLTFLoader();
    loader.load('assets/objects/ISS_stationary.glb', function (gltf) {
        issGroup.add(iss = gltf.scene);
        camera.updateProjectionMatrix();
    }, function (xhr) {
    }, function (error) {
        console.error(error);
    });

    // ISS label
    issLabel = new THREE.TextSprite({
        fillStyle: '#FFFFFF',
        fontFamily: 'Arial',
        fontSize: 0,
        text: [
            'International Space Station',
        ].join('\n'),
    });
    issGroup.add(issLabel);

    // Init
    updateSpace(new Date());

    return scene;
}

function updateSpace(date) {
    // Get ISS data
    let {
        latitude: latitude,
        longitude: longitude,
        totalHeight: totalHeight,
        rotation: rotation,
        position: position
    } = getPositionAndRotationOfISS(date);

    // Update the position everything inside of the earth container
    centerGroup.position.set(0, -totalHeight, 0);

    // Rotate the earth with the ISS position to the top
    earthGroup.rotation.x = toRadians(-latitude + 90);
    earthGroup.rotation.y = toRadians(-longitude + 90);

    // Set the absolute position in the iss group
    issGroup.position.set(position.x, position.y, position.z);

    // Update rotation of the ISS model
    if (iss != null) {
        iss.rotation.set(rotation.x, rotation.y, rotation.z);
    }

    // Calculate sun position
    let {lng: sunLon, lat: sunLat} = getPositionOfSun(date);
    let sunPosition = latLonToVector3(sunLat, sunLon + 90, SUN_DISTANCE);
    sunGroup.position.set(sunPosition.x, sunPosition.y, sunPosition.z);
}

function updateCameraAndControls(camera, controls) {
    let radius = controls.getRadius();
    let hasFocusOnIss = radius < Math.max(-earth.position.y, EARTH_RADIUS);

    controls.minDistance = 10;
    controls.maxDistance = EARTH_RADIUS * 3;
    controls.zoomSpeed = radius < 200 || radius >= EARTH_RADIUS ? 1 : 8;

    // Label of the ISS
    issLabel.fontSize = hasFocusOnIss ? 0 : 135000 - (EARTH_RADIUS * 3 - radius) / 91 + 10000;

    // Update near rendering distance
    updateNearDistance(camera, radius);

    if (iss != null) {
        updateCameraTarget(camera, controls, hasFocusOnIss);
    }

    if (atmosphere != null) {
        updateAtmosphere(camera, hasFocusOnIss);
    }
}

function updateAtmosphere(camera, hasFocusOnIss) {
    // The camera vector
    let cameraVector = new THREE.Vector3(camera.matrix.elements[8], camera.matrix.elements[9], camera.matrix.elements[10]);

    // Calculate a perfect vector over the horizon
    let dummyCameraPosition = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z);
    let dummyPosition = dummyCameraPosition.clone();
    dummyPosition.add(cameraVector.clone().multiplyScalar(-1));
    dummyPosition.y = dummyCameraPosition.y - 1.0;
    let fixedIssViewVector = new THREE.Vector3().subVectors(camera.position, dummyPosition);

    // Looking straight to earth or over the horizon
    atmosphere.material.uniforms.viewVector.value = hasFocusOnIss ? fixedIssViewVector : cameraVector;
}

function updateCameraTarget(camera, controls, hasFocusOnIss) {
    if (cameraState === 0) {
        if (!hasFocusOnIss) {
            // Called when the camera moves out of the iss
            cameraState = 1;

            // Change target
            controls.target = centerGroup.position;

            // High terrain height map resolution
            earth.material.bumpScale = 10000;

            // Update
            camera.updateProjectionMatrix();
        }
    } else {
        if (hasFocusOnIss) {
            // Called when the camera moved back into the iss
            cameraState = 0;

            // Change target
            controls.target = new THREE.Vector3(0, 0, 0);

            // Low terrain height map resolution
            earth.material.bumpScale = 1000;

            // Set camera position above the ISS
            let teleportRequired = camera.position.x !== centerGroup.position.x || camera.position.z !== centerGroup.position.z;
            if (teleportRequired) {
                camera.position.x = centerGroup.position.x;
                camera.position.y = 3000;
                camera.position.z = centerGroup.position.z;
            }

            // Update
            camera.updateProjectionMatrix();
        }
    }
}

function updateNearDistance(camera, radius) {
    let prevCameraNear = camera.near;
    camera.near = radius < 10000 ? 1 : 100000;

    if (prevCameraNear !== camera.near) {
        camera.updateProjectionMatrix();
    }
}


function createAtmosphereMaterial(callback) {
    const loader = new THREE.FileLoader();
    loader.load("assets/shaders/atmosphere.frag", function (fragmentShader) {
        loader.load("assets/shaders/atmosphere.vert", function (vertexShader) {
            const material = new THREE.ShaderMaterial({
                uniforms: THREE.UniformsUtils.merge([
                    THREE.UniformsLib.shadowmap,
                    THREE.UniformsLib.lights,
                    THREE.UniformsLib.ambient,
                    {
                        "c": {
                            type: "f",
                            value: 0.6
                        },
                        "p": {
                            type: "f",
                            value: 0.9
                        },
                        glowColor: {
                            type: "c",
                            value: new THREE.Color(0x47AEF7)
                        },
                        viewVector: {
                            type: "v3",
                            value: new THREE.Vector3(0, 0, 0)
                        }
                    }]),
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                side: THREE.FrontSide,
                blending: THREE.AdditiveBlending,
                transparent: true,
                lights: true
            });

            callback(material);
        });
    });
}