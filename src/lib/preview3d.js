import * as THREE from 'three';
import {previewBuffers} from './preview-buffers.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

export function createModelPreview(container,onZoom=()=>{}) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x202620,1);
  container.replaceChildren(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','3D model. Drag to orbit, scroll to zoom.');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,10000);
  camera.up.set(0,0,1);
  const controls=new OrbitControls(camera,renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x728080,2));
  const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-200,-150,400);scene.add(light);
  let object,fitDistance=0;
  const viewDirection=new THREE.Vector3(.9,-1.2,1.4).normalize();
  const render=()=>renderer.render(scene,camera);
  controls.addEventListener('change',()=>{
    if(fitDistance)onZoom(fitDistance/controls.getDistance());
    render();
  });
  const reset=()=>{
    if(!object || !container.clientWidth || !container.clientHeight)return;
    camera.aspect=container.clientWidth/container.clientHeight;
    const sphere=object.geometry.boundingSphere;
    const verticalFov=THREE.MathUtils.degToRad(camera.fov/2);
    const halfFov=Math.min(verticalFov,Math.atan(Math.tan(verticalFov)*camera.aspect));
    fitDistance=Math.max(1,sphere.radius)/Math.sin(halfFov)*1.08;
    controls.minDistance=fitDistance/4;
    controls.maxDistance=fitDistance/.35;
    camera.far=Math.max(10000,controls.maxDistance+sphere.radius*2);
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    camera.position.copy(controls.target).addScaledVector(viewDirection,fitDistance);
    controls.update();
    onZoom(1);
  };
  function resize(){
    const w=container.clientWidth,h=container.clientHeight;
    if(!w||!h)return;
    renderer.setSize(w,h);
    if(object && (!fitDistance || Math.abs(controls.getDistance()/fitDistance-1)<.005))reset();
    else{
      camera.aspect=w/h;
      camera.updateProjectionMatrix();
    }
    render();
  }
  const observer=new ResizeObserver(resize);
  observer.observe(container);
  const zoom=direction=>{
    if(!fitDistance)return;
    const offset=camera.position.clone().sub(controls.target);
    const distance=THREE.MathUtils.clamp(offset.length()*(direction>0?1/1.2:1.2),controls.minDistance,controls.maxDistance);
    camera.position.copy(controls.target).add(offset.setLength(distance));
    controls.update();
  };
  return {
    set(next) {
      if(object){scene.remove(object);object.geometry.dispose();object.material.dispose();}
      const {positions,colors}=next.display??previewBuffers(next.mesh);
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0,flatShading:true}));
      scene.add(object);
      fitDistance=0;
      resize();
    },reset,zoom,
    dispose(){observer.disconnect();controls.dispose();if(object){object.geometry.dispose();object.material.dispose();}renderer.dispose();container.replaceChildren();}
  };
}
