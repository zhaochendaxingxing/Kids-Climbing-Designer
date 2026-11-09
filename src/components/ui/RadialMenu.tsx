'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { getPartById, PARTS_LIBRARY, PART_COLORS } from '@/data/parts';

interface RadialMenuProps {
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export default function RadialMenu({ position, onClose }: RadialMenuProps) {
  const selectedPartId = useStore((s) => s.selectedPartId);
  const parts = useStore((s) => s.parts);
  const removePart = useStore((s) => s.removePart);
  const setInteractionMode = useStore((s) => s.setInteractionMode);
  const setRotationPreviewEnabled = useStore((s) => s.setRotationPreviewEnabled);
  const setRotationPreviewVariants = useStore((s) => s.setRotationPreviewVariants);
  const replacePart = useStore((s) => s.replacePart);
  const addBarFromConnector = useStore((s) => s.addBarFromConnector);
  const [showReplaceMenu, setShowReplaceMenu] = useState(false);

  const selectedPart = useMemo(() => {
    if (!selectedPartId) return null;
    return parts.find((p) => p.id === selectedPartId) || null;
  }, [selectedPartId, parts]);

  const def = useMemo(() => {
    if (!selectedPart) return null;
    return getPartById(selectedPart.partId);
  }, [selectedPart]);

  // 同类替换选项（必须在所有 hooks 之前定义）
  const sameCategoryParts = useMemo(() => {
    if (!def) return [];
    return PARTS_LIBRARY.filter(
      (p) => p.category === def.category && p.id !== (selectedPart?.partId || '') && p.id !== 'connector-45deg-nest'
    );
  }, [def, selectedPart]);

  if (!position || !selectedPart || !def) return null;

  const isConnector = def.category === 'connector';

  // 生成旋转预览变体
  const enterRotationPreview = () => {
    const variants: { euler: [number, number, number] }[] = [];
    const axes = [0, 1, 2]; // x, y, z
    const angles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, 5*Math.PI/4, 3*Math.PI/2, 7*Math.PI/4];
    
    const current = selectedPart.rotation;
    variants.push({ euler: current }); // 当前旋转作为第一个
    
    for (const axisIdx of axes) {
      for (const angle of angles) {
        const euler: [number, number, number] = [...current] as [number, number, number];
        euler[axisIdx] = angle;
        // 检查是否已存在
        const exists = variants.some(
          (v) => Math.abs(v.euler[0] - euler[0]) < 0.01 && 
                 Math.abs(v.euler[1] - euler[1]) < 0.01 && 
                 Math.abs(v.euler[2] - euler[2]) < 0.01
        );
        if (!exists) {
          variants.push({ euler });
        }
      }
    }
    
    setRotationPreviewVariants(variants);
    setRotationPreviewEnabled(true);
    onClose();
  };

  // 基础菜单项（4个主按钮：移动、旋转、替换、删除）
  const mainItems = [
    {
      id: 'move',
      label: '移动',
      icon: '⟷',
      action: () => { setInteractionMode('move'); onClose(); },
      color: '#4A90D9',
    },
    {
      id: 'rotate',
      label: '旋转',
      icon: '⟳',
      action: enterRotationPreview,
      color: '#FF9F43',
    },
    {
      id: 'replace',
      label: '替换',
      icon: '⇄',
      action: () => { setShowReplaceMenu(!showReplaceMenu); },
      color: '#26C281',
    },
    {
      id: 'delete',
      label: '删除',
      icon: '✕',
      action: () => { removePart(selectedPart.id); onClose(); },
      color: '#EE5A5A',
    },
  ];

  // 转接头连接方向菜单
  const connectorDirections = [
    { id: 'x+', label: 'X+', icon: '→', dir: 'x+' as const, color: '#4A90D9' },
    { id: 'x-', label: 'X-', icon: '←', dir: 'x-' as const, color: '#4A90D9' },
    { id: 'y+', label: 'Y+', icon: '↑', dir: 'y+' as const, color: '#4A90D9' },
    { id: 'y-', label: 'Y-', icon: '↓', dir: 'y-' as const, color: '#4A90D9' },
    { id: 'z+', label: 'Z+', icon: '↗', dir: 'z+' as const, color: '#4A90D9' },
    { id: 'z-', label: 'Z-', icon: '↙', dir: 'z-' as const, color: '#4A90D9' },
    { id: 'x+45', label: 'X+45°', icon: '↘', dir: 'x+45' as const, color: '#26C281' },
    { id: 'x-45', label: 'X-45°', icon: '↖', dir: 'x-45' as const, color: '#26C281' },
    { id: 'z+45', label: 'Z+45°', icon: '↕', dir: 'z+45' as const, color: '#26C281' },
    { id: 'z-45', label: 'Z-45°', icon: '↔', dir: 'z-45' as const, color: '#26C281' },
  ];

  // 确定当前显示的菜单项（替换菜单改用独立垂直滚动列表，不再走扇形）
  let displayItems = mainItems;

  // 方向字符串转向量
  const dirToVector = (dir: string): [number, number, number] => {
    switch (dir) {
      case 'x+': return [1, 0, 0];
      case 'x-': return [-1, 0, 0];
      case 'y+': return [0, 1, 0];
      case 'y-': return [0, -1, 0];
      case 'z+': return [0, 0, 1];
      case 'z-': return [0, 0, -1];
      case 'x+45': return [0.7071, 0, 0.7071];
      case 'x-45': return [-0.7071, 0, 0.7071];
      case 'z+45': return [0.7071, 0, -0.7071];
      case 'z-45': return [-0.7071, 0, -0.7071];
      default: return [1, 0, 0];
    }
  };

  const totalItems = displayItems.length;

  return (
    <div
      className="fixed z-50"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="relative">
        {/* 中心圆点 - 显示当前菜单名 */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg border-2 border-gray-200 z-10 flex items-center justify-center text-xs font-bold text-gray-600 cursor-pointer hover:bg-gray-100"
          onClick={() => { if (showReplaceMenu) setShowReplaceMenu(false); else onClose(); }}
        >
          {showReplaceMenu ? '←' : '✕'}
        </div>

        {/* 扇形菜单项（主菜单） */}
        {!showReplaceMenu && displayItems.map((item, index) => {
          const angle = (index / totalItems) * Math.PI * 2 - Math.PI / 2;
          const radius = isConnector ? 100 : 80;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;

          return (
            <button
              key={item.id}
              className="absolute flex flex-col items-center justify-center rounded-full shadow-lg hover:shadow-xl transition-all duration-200 border-2 cursor-pointer hover:scale-110"
              style={{
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                transform: 'translate(-50%, -50%)',
                width: 64,
                height: 64,
                backgroundColor: item.color + '20',
                borderColor: item.color,
                color: item.color,
              }}
              onClick={item.action}
              title={item.label}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-[10px] font-bold mt-0.5">{item.label}</span>
            </button>
          );
        })}

        {/* 同类替换下拉列表（垂直可滚动，避免版边信息缺失） */}
        {showReplaceMenu && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden w-[170px]">
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 border-b border-gray-100 bg-gray-50">
                替换为同类型
              </div>
              <ul className="max-h-64 overflow-y-auto py-1">
                {sameCategoryParts.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-gray-400">无可替换的同类件</li>
                ) : (
                  sameCategoryParts.map((p) => (
                    <li key={p.id}>
                      <button
                        className="w-full text-left px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-[#26C28120] hover:text-[#26C281] transition-colors cursor-pointer whitespace-nowrap"
                        onClick={() => { replacePart(selectedPart.id, p.id); onClose(); }}
                      >
                        {p.name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        )}

        {/* 如果是转接头，在主菜单下方显示连接方向 */}
        {isConnector && !showReplaceMenu && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 translate-y-full">
            <div className="text-[10px] text-center text-gray-400 mb-1 font-medium">添加横杆</div>
            <div className="flex flex-wrap justify-center gap-1 max-w-[200px]">
              {connectorDirections.map((dir) => (
                <button
                  key={dir.id}
                  className="px-2 py-0.5 rounded text-[10px] font-bold border hover:scale-110 transition-all cursor-pointer"
                  style={{
                    backgroundColor: dir.color + '15',
                    borderColor: dir.color + '80',
                    color: dir.color,
                  }}
                  onClick={() => { addBarFromConnector(selectedPart.id, 'bar-50cm', dirToVector(dir.dir)); onClose(); }}
                >
                  {dir.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}