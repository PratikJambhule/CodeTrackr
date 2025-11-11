import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './Hyperspeed.css';

const Hyperspeed = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 10, 50);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 5;
    camera.position.y = 2;
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create highway
    const roadGeometry = new THREE.PlaneGeometry(10, 100, 50, 50);
    const roadMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a,
      side: THREE.DoubleSide,
      wireframe: false
    });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.z = -25;
    scene.add(road);

    // Create lane markers
    const laneGroup = new THREE.Group();
    for (let i = 0; i < 20; i++) {
      const markerGeometry = new THREE.BoxGeometry(0.2, 0.1, 2);
      const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(0, 0.05, -i * 5);
      laneGroup.add(marker);
    }
    laneGroup.rotation.x = -Math.PI / 2;
    scene.add(laneGroup);

    // Create light streaks
    const lights: THREE.Mesh[] = [];
    for (let i = 0; i < 40; i++) {
      const lightGeometry = new THREE.CylinderGeometry(0.1, 0.1, 3, 8);
      const isLeft = Math.random() > 0.5;
      const color = isLeft ? 0xff3366 : 0x00ccff;
      const lightMaterial = new THREE.MeshBasicMaterial({ color });
      const light = new THREE.Mesh(lightGeometry, lightMaterial);
      
      light.position.x = isLeft ? -3 : 3;
      light.position.y = 0.5;
      light.position.z = -Math.random() * 50;
      light.rotation.x = Math.PI / 2;
      
      scene.add(light);
      lights.push(light);
    }

    // Create stars
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.1,
      transparent: true,
      opacity: 0.8
    });

    const starsVertices = [];
    for (let i = 0; i < 1000; i++) {
      const x = (Math.random() - 0.5) * 100;
      const y = Math.random() * 50;
      const z = (Math.random() - 0.5) * 100;
      starsVertices.push(x, y, z);
    }

    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);

    // Animation
    const speed = 0.5;
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      // Move lane markers
      laneGroup.children.forEach((marker: THREE.Object3D) => {
        marker.position.z += speed;
        if (marker.position.z > 5) {
          marker.position.z = -95;
        }
      });

      // Move lights
      lights.forEach((light) => {
        light.position.z += speed * (light.position.x < 0 ? 1.5 : 2);
        if (light.position.z > 10) {
          light.position.z = -50 - Math.random() * 20;
        }
      });

      // Camera wobble
      camera.position.x = Math.sin(Date.now() * 0.0005) * 0.5;
      camera.position.y = 2 + Math.sin(Date.now() * 0.0003) * 0.3;

      renderer.render(scene, camera);
    };

    animate();

    // Handle resize
    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
      }
    };
  }, []);

  return <div id="lights" ref={containerRef} className="hyperspeed-container" />;
};

export default Hyperspeed;
