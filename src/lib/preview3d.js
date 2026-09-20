import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

export function createModelPreview(container) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x132d30,1);
  container.replaceChildren(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','3D model. Drag to orbit, scroll to zoom.');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,10000);
  camera.up.set(0,0,1);
  const controls=new OrbitControls(camera,renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x728080,2));
  const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-200,-150,400);scene.add(light);
  let object,model;
  const render=()=>renderer.render(scene,camera);
  controls.addEventListener('change',render);
  const resize=()=>{const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();};
  const observer=new ResizeObserver(resize);observer.observe(container);
  const reset=()=>{if(!model)return;const size=Math.max(model.width,model.height);controls.target.set(model.width/2,model.height/2,0);camera.position.set(model.width/2+size*.9,model.height/2-size*1.2,size*1.4);controls.update();resize();};
  const zoom=direction=>{if(!model)return;const offset=camera.position.clone().sub(controls.target),factor=direction>0?.82:1.22;offset.multiplyScalar(factor);camera.position.copy(controls.target).add(offset);controls.update();render();};
  return {
    set(next) {
      if(object){scene.remove(object);object.geometry.dispose();object.material.dispose();}
      model=next;
      const positions=new Float32Array(next.mesh.t.length*9),colors=new Float32Array(positions.length),color=new THREE.Color();
      next.mesh.t.forEach((tri,i)=>{color.set(next.mesh.colors[i]||'#D4D6C8');tri.forEach((id,j)=>{positions.set(next.mesh.v[id],i*9+j*3);colors.set([color.r,color.g,color.b],i*9+j*3);});});
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.computeVertexNormals();
      object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0,flatShading:true}));scene.add(object);reset();
    },reset,zoom,
    dispose(){observer.disconnect();controls.dispose();if(object){object.geometry.dispose();object.material.dispose();}renderer.dispose();container.replaceChildren();}
  };
}
