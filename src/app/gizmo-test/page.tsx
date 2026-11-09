'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformGizmo, type GizmoHitInfo } from '@/components/gizmo/TransformGizmo';

export default function GizmoTestPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gizmoRef = useRef<TransformGizmo | null>(null);

  const selectedObjsRef = useRef<THREE.Mesh[]>([]);
  const gizmoDraggingRef = useRef(false);
  const hoverInfoRef = useRef<GizmoHitInfo | null>(null);
  const isShiftPressedRef = useRef(false);
  const isAltPressedRef = useRef(false);
  const duplicatedRef = useRef(false);
  const hoverDebugCounter = useRef(0);

  const [status, setStatus] = useState('点击物体选中，然后可以拖动操作轴');
  const [selectedCount, setSelectedCount] = useState(0);
  const [mode, setMode] = useState<'both' | 'translate' | 'rotate'>('both');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [controlsEnabled, setControlsEnabled] = useState(true);
  const [debugLog, setDebugLog] = useState<string[]>(['等待操作...']);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5fa);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000,
    );
    camera.position.set(120, 100, 150);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controlsRef.current = controls;

    // 灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(50, 100, 80);
    scene.add(dirLight);

    // 网格
    scene.add(new THREE.GridHelper(200, 20, 0xcccccc, 0xe5e5e5));

    // 轴向辅助线（地面 X/Z 轴）
    const axesHelper = new THREE.AxesHelper(30);
    scene.add(axesHelper);

    // 测试物体
    const objects: THREE.Mesh[] = [];
    const cubeGeo = new THREE.BoxGeometry(20, 20, 20);

    const colors = [0x6366f1, 0x22c55e, 0xf59e0b];
    const positions: [number, number, number][] = [[0, 10, 0], [45, 10, 25], [-35, 10, -25]];
    colors.forEach((color, i) => {
      const cube = new THREE.Mesh(
        cubeGeo,
        new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.5 }),
      );
      cube.position.set(...positions[i]);
      cube.userData = { name: `立方体${i + 1}`, isTarget: true };
      scene.add(cube);
      objects.push(cube);
    });

    // 球体
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(12, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xec4899, metalness: 0.2, roughness: 0.4 }),
    );
    sphere.position.set(20, 12, -30);
    sphere.userData = { name: '球体D', isTarget: true };
    scene.add(sphere);
    objects.push(sphere);

    // Gizmo — 始终可见，size=60 更大更醒目
    const gizmo = new TransformGizmo({ size: 60, snapStep: 5, rotationStep: 15 });
    gizmo.setVisible(true);
    gizmo.setPosition(0, 0, 0);
    scene.add(gizmo.group);
    gizmoRef.current = gizmo;
    console.log('[gizmo-test] Gizmo 已创建，始终可见，位置(0,0,0)');

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    function log(msg: string) {
      const time = new Date().toLocaleTimeString();
      setDebugLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 20));
    }

    function updateMouse(e: MouseEvent) {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
    }

    // ========== 事件处理（捕获阶段，优先于 OrbitControls） ==========

    const onPointerDownCapture = (e: MouseEvent) => {
      if (e.button !== 0) return; // 只处理左键
      updateMouse(e);

      // 1. 先检查 gizmo
      if (gizmo.group.visible) {
        const hit = gizmo.intersect(raycaster);
        if (hit) {
          // 命中 gizmo —— 完全接管，阻止 OrbitControls 收到事件
          e.stopImmediatePropagation();
          e.preventDefault();

          controls.enabled = false;
          setControlsEnabled(false);
          gizmoDraggingRef.current = true;
          gizmo.startDrag(hit, camera);

          log(`🔴 点中 gizmo: ${hit.type} ${hit.axis || hit.plane || ''}`);
          setStatus(`拖拽中: ${hit.type} ${hit.axis || hit.plane || ''}`);

          // Alt + 拖拽复制
          if (isAltPressedRef.current && selectedObjsRef.current.length > 0) {
            duplicatedRef.current = true;
            const newSelected: THREE.Mesh[] = [];
            for (const obj of selectedObjsRef.current) {
              const clone = obj.clone() as THREE.Mesh;
              clone.material = (obj.material as THREE.MeshStandardMaterial).clone();
              clone.position.copy(obj.position);
              clone.rotation.copy(obj.rotation);
              clone.userData = { ...obj.userData, name: obj.userData.name + ' (副本)' };
              scene.add(clone);
              objects.push(clone);
              newSelected.push(clone);
            }
            clearSelectionVisual();
            selectedObjsRef.current = newSelected;
            highlightSelection();
            // 重新计算 gizmo 位置（因为选中物体变了）
            updateGizmoToCenter();
            // 但是要重新计算拖拽起点... 简化：重新 startDrag
            gizmo.endDrag();
            gizmo.startDrag(hit, camera);
            setSelectedCount(newSelected.length);
            log('📋 已复制物体');
          }

          return;
        }
      }

      // 2. 检查物体
      const hits = raycaster.intersectObjects(objects, false);
      if (hits.length > 0) {
        const hitObj = hits[0].object as THREE.Mesh;

        if (isShiftPressedRef.current) {
          if (selectedObjsRef.current.includes(hitObj)) {
            // 取消选中
            const idx = selectedObjsRef.current.indexOf(hitObj);
            selectedObjsRef.current.splice(idx, 1);
            const mat = hitObj.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0);
            mat.emissiveIntensity = 0;
            log(`⬜ 取消选中: ${hitObj.userData.name}`);
          } else {
            selectedObjsRef.current.push(hitObj);
            log(`🟩 加选: ${hitObj.userData.name}`);
          }
        } else {
          clearSelectionVisual();
          selectedObjsRef.current = [hitObj];
          log(`🟦 选中: ${hitObj.userData.name}`);
        }

        highlightSelection();

        if (selectedObjsRef.current.length > 0) {
          updateGizmoToCenter();
          gizmo.setVisible(true);
        } else {
          gizmo.setVisible(false);
        }

        setSelectedCount(selectedObjsRef.current.length);
        setStatus(`已选中 ${selectedObjsRef.current.length} 个物体`);

        // 选中物体时也阻止一下，但如果想允许拖拽旋转可以不阻止
        // 这里不 stopImmediatePropagation，让 OrbitControls 也能响应（相机旋转）
        return;
      }

      // 3. 点击空白 = 取消选中
      if (!isShiftPressedRef.current) {
        clearSelectionVisual();
        selectedObjsRef.current = [];
        gizmo.setVisible(false);
        setSelectedCount(0);
        setStatus('已取消选择');
        log('⬜ 点击空白，取消选择');
      }
    };

    const onPointerMoveCapture = (e: MouseEvent) => {
      updateMouse(e);

      // 拖拽中
      if (gizmoDraggingRef.current) {
        e.stopImmediatePropagation();
        const result = gizmo.onDrag(raycaster);

        if (result.position) {
          const [x, y, z] = result.position;
          gizmo.setPosition(x, y, z);

          // 更新所有选中物体位置
          if (selectedObjsRef.current.length > 0) {
            const gizmoPos = new THREE.Vector3(x, y, z);
            for (const obj of selectedObjsRef.current) {
              const rel = obj.userData.relToGizmo as THREE.Vector3;
              if (rel) {
                obj.position.copy(gizmoPos.clone().add(rel));
              }
            }
          }
        }

        if (result.rotation) {
          const [rx, ry, rz] = result.rotation;
          gizmo.setRotation(rx, ry, rz);

          // 更新所有选中物体旋转（绕 gizmo 中心）
          if (selectedObjsRef.current.length > 0) {
            const gizmoPos = gizmo.group.position.clone();
            const gizmoQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
            for (const obj of selectedObjsRef.current) {
              const rel = (obj.userData.relToGizmo as THREE.Vector3) || new THREE.Vector3();
              const rotatedRel = rel.clone().applyQuaternion(gizmoQuat);
              obj.position.copy(gizmoPos.clone().add(rotatedRel));
              obj.rotation.set(rx, ry, rz);
            }
          }
        }

        return;
      }

      // 悬停检测（非拖拽时）
      if (gizmo.group.visible) {
        const hit = gizmo.intersect(raycaster);

        // 悬停到 gizmo 上时，阻止 OrbitControls 的 mousemove，防止 cursor 被覆盖
        if (hit) {
          e.stopImmediatePropagation();
          renderer.domElement.style.cursor = 'pointer';
          if (hoverDebugCounter.current % 60 === 0) {
            console.log('[gizmo-debug] ✅ 命中! cursor设为pointer');
          }
        }

        // 调试：每30帧打印一次gizmo所有手柄的射线检测结果
        hoverDebugCounter.current = (hoverDebugCounter.current || 0) + 1;
        if (hoverDebugCounter.current % 60 === 0) {
          const g = gizmoRef.current;
          if (g && g.group.visible) {
            const allHits = raycaster.intersectObjects([g.group], true);
            console.log(
              '[gizmo-debug] 帧#' + hoverDebugCounter.current,
              'gizmo可见=' + g.group.visible,
              'pos=' + g.group.position.toArray().map(v => v.toFixed(1)).join(','),
              'hit=' + (hit ? hit.type + ':' + (hit.axis || hit.plane || '') : '无'),
              '递归命中数=' + allHits.length,
              'handleMap=' + (g as any).handleMap?.size,
            );
          } else {
            console.log('[gizmo-debug] 帧#' + hoverDebugCounter.current, 'gizmo不可见或不存在');
          }
        }

        const hitKey = hit ? { type: hit.type, axis: hit.axis, plane: hit.plane } : null;

        // 比较是否变化
        const changed =
          (!hoverInfoRef.current && hit) ||
          (hoverInfoRef.current && !hit) ||
          (hoverInfoRef.current && hit && (
            hoverInfoRef.current.type !== hit.type ||
            hoverInfoRef.current.axis !== hit.axis ||
            hoverInfoRef.current.plane !== hit.plane
          ));

        if (changed) {
          hoverInfoRef.current = hit;
          gizmo.setHover(hitKey);

          if (hit) {
            // 悬停 gizmo 时禁用轨道控制，防止点击瞬间冲突
            if (controls.enabled) {
              controls.enabled = false;
              setControlsEnabled(false);
            }
            log(`✨ 悬停 gizmo: ${hit.type}${hit.axis ? ' ' + hit.axis : hit.plane ? ' ' + hit.plane : ''}`);
          } else {
            renderer.domElement.style.cursor = 'grab';
            if (!controls.enabled) {
              controls.enabled = true;
              setControlsEnabled(true);
            }
          }
        }
      }
    };

    const onPointerUpCapture = (e: MouseEvent) => {
      if (gizmoDraggingRef.current) {
        e.stopImmediatePropagation();
        gizmoDraggingRef.current = false;
        gizmo.endDrag();

        // 重新计算相对偏移
        saveRelOffsets();

        // 恢复 OrbitControls
        controls.enabled = true;
        setControlsEnabled(true);

        if (duplicatedRef.current) {
          duplicatedRef.current = false;
          setStatus(`复制完成，共 ${selectedObjsRef.current.length} 个物体`);
          log('✅ 复制拖拽完成');
        } else {
          setStatus(`已选中 ${selectedObjsRef.current.length} 个物体`);
          log('✅ 拖拽完成');
        }
      }
    };

    // ========== 键盘事件 ==========

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressedRef.current = true;
      if (e.key === 'Alt' || e.key === 'Option') isAltPressedRef.current = true;
      if (e.key === 'Escape') {
        clearSelectionVisual();
        selectedObjsRef.current = [];
        gizmo.setVisible(false);
        setSelectedCount(0);
        setStatus('已取消选择');
        log('⎋ Esc 取消选择');
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressedRef.current = false;
      if (e.key === 'Alt' || e.key === 'Option') isAltPressedRef.current = false;
    };

    // ========== 辅助函数 ==========

    function clearSelectionVisual() {
      for (const obj of selectedObjsRef.current) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0);
        mat.emissiveIntensity = 0;
      }
    }

    function highlightSelection() {
      for (const obj of selectedObjsRef.current) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x2244aa);
        mat.emissiveIntensity = 0.4;
      }
    }

    function updateGizmoToCenter() {
      if (selectedObjsRef.current.length === 0) return;
      const center = new THREE.Vector3();
      for (const obj of selectedObjsRef.current) {
        center.add(obj.position);
      }
      center.divideScalar(selectedObjsRef.current.length);
      gizmo.setPosition(center.x, center.y, center.z);
      gizmo.setRotation(0, 0, 0);
      saveRelOffsets();
    }

    function saveRelOffsets() {
      const gizmoPos = gizmo.group.position.clone();
      for (const obj of selectedObjsRef.current) {
        obj.userData.relToGizmo = new THREE.Vector3().subVectors(obj.position, gizmoPos);
      }
    }

    // ========== 事件绑定（捕获阶段！优先级高于 OrbitControls） ==========

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', onPointerDownCapture, true);
    canvas.addEventListener('pointermove', onPointerMoveCapture, true);
    canvas.addEventListener('pointerup', onPointerUpCapture, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // 窗口大小
    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // 动画循环
    let frameId = 0;
    let autoDone = false;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      
      // 第一帧：渲染完成后自动选中
      if (!autoDone && objects.length > 0) {
        autoDone = true;
        const firstObj = objects[0];
        clearSelectionVisual();
        selectedObjsRef.current = [firstObj];
        highlightSelection();
        const gizmo = gizmoRef.current;
        if (gizmo) {
          gizmo.setPosition(firstObj.position.x, firstObj.position.y, firstObj.position.z);
        }
        setSelectedCount(1);
        setStatus('已选中 1 个物体');
        console.log('[gizmo-test] 🚀 自动选中:', firstObj.userData.name);
        setDebugLog(prev => {
          const time = new Date().toLocaleTimeString();
          return [`[${time}] 🚀 页面就绪，自动选中${firstObj.userData.name}`, `[${time}] 🟦 选中: ${firstObj.userData.name}`, ...prev].slice(0, 20);
        });
      }
    // 每 120 帧输出一次 gizmo 状态（帮助调试）
      if (frameId % 120 === 0) {
        const g = gizmoRef.current;
        if (g) {
          console.log('[gizmo-test] 状态:', 'visible=' + g.group.visible, 'pos=' + g.group.position.toArray().map(v => v.toFixed(1)).join(','), 'handleMap=' + (g as any).handleMap?.size);
        }
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('pointerdown', onPointerDownCapture, true);
      canvas.removeEventListener('pointermove', onPointerMoveCapture, true);
      canvas.removeEventListener('pointerup', onPointerUpCapture, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      controls.dispose();
      gizmo.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleModeChange = (newMode: 'both' | 'translate' | 'rotate') => {
    setMode(newMode);
    if (gizmoRef.current) {
      gizmoRef.current.setMode(newMode);
    }
  };

  const handleSnapToggle = () => {
    const newVal = !snapEnabled;
    setSnapEnabled(newVal);
    if (gizmoRef.current) {
      gizmoRef.current.setSnapStep(newVal ? 5 : 0);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-100 select-none">
      {/* 顶部工具栏 */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-slate-800">操作轴 (TransformGizmo) 测试</h1>
          <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
            选中: {selectedCount}
          </div>
          <div className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm">
            {status}
          </div>
          <div className={`px-2 py-1 rounded text-xs ${controlsEnabled ? 'bg-slate-200 text-slate-600' : 'bg-orange-100 text-orange-700'}`}>
            轨道控制: {controlsEnabled ? '开启' : '禁用'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleModeChange('both')}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              mode === 'both' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => handleModeChange('translate')}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              mode === 'translate' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            移动
          </button>
          <button
            onClick={() => handleModeChange('rotate')}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              mode === 'rotate' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            旋转
          </button>
          <div className="w-px h-6 bg-slate-300 mx-1" />
          <button
            onClick={handleSnapToggle}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              snapEnabled ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {snapEnabled ? '吸附 5cm' : '吸附 关'}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 text-sm bg-slate-600 text-white rounded-md hover:bg-slate-700 transition"
          >
            重置
          </button>
        </div>
      </div>

      {/* 主体：左 2/3 3D场景 + 右 1/3 调试面板 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左 2/3: 3D 视口 */}
        <div ref={containerRef} className="flex-[2] relative overflow-hidden">
          {/* 操作说明 */}
          <div className="absolute top-4 left-4 bg-white/95 backdrop-blur rounded-lg shadow-md p-4 text-sm text-slate-700 space-y-2 z-10 w-72">
            <div className="font-bold text-slate-800 mb-2 text-base">🎮 操作说明</div>
            <div className="flex items-start gap-2">
              <span className="text-blue-600 font-bold w-28 shrink-0">点击物体</span>
              <span>选中（蓝色发光）</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-600 font-bold w-28 shrink-0">Shift + 点击</span>
              <span>多选 / 取消选中</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-red-500 font-bold w-28 shrink-0">Alt + 拖拽</span>
              <span>复制物体 + 移动</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-600 font-bold w-28 shrink-0">拖轴箭头</span>
              <span>沿单轴方向移动</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-amber-600 font-bold w-28 shrink-0">拖方块面</span>
              <span>平面内平移</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-cyan-600 font-bold w-28 shrink-0">拖弧线</span>
              <span>绕轴旋转</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-500 font-bold w-28 shrink-0">Esc</span>
              <span>取消全部选中</span>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200 text-xs text-slate-500">
              💡 轴上的半透明圆柱是点击区域，鼠标悬停会变黄
            </div>
          </div>
        </div>

        {/* 右 1/3: 调试面板（固定区域，始终可见） */}
        <div className="flex-1 bg-slate-900 text-white p-4 overflow-auto border-l border-slate-700 flex flex-col" style={{ fontFamily: 'monospace' }}>
          <div className="text-yellow-400 font-bold text-base mb-3 flex items-center justify-between shrink-0">
            <span>🔍 调试日志</span>
            <div className="flex gap-2">
              <span className="text-xs text-slate-400 font-normal">
                选中: {selectedCount} | 吸附: {snapEnabled ? '5cm' : '关'}
              </span>
              <button
                onClick={() => setDebugLog([])}
                className="text-xs text-slate-400 hover:text-white bg-slate-700 px-2 py-0.5 rounded"
              >
                清空
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto space-y-1">
            {debugLog.length === 0 ? (
              <div className="text-yellow-300 text-sm">等待交互事件... 点击物体后会出现操作轴</div>
            ) : (
              debugLog.map((line, i) => (
                <div key={i} className={`text-sm leading-relaxed ${i === 0 ? 'text-green-400 font-bold' : 'text-slate-300'}`}>
                  {line}
                </div>
              ))
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-500 shrink-0">
            X 红 | Y 绿 | Z 蓝 | 轴箭头·平面方块·弧线旋转
          </div>
        </div>
      </div>
    </div>
  );
}
