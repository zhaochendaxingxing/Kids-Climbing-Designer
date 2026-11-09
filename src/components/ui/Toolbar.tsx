import { useState } from 'react';
import { Button, Tooltip, Divider, Select } from 'antd';
import {
  UndoOutlined,
  RedoOutlined,
  SaveOutlined,
  FolderOpenOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  DeleteOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  VerticalAlignTopOutlined,
  BgColorsOutlined,
  BorderOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { useStore } from '@/store/useStore';
import { PART_COLORS } from '@/data/parts';

const { Option } = Select;

interface ToolbarProps {
  onSave: () => void;
  onLoad: () => void;
}

export function Toolbar({ onSave, onLoad }: ToolbarProps) {
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const canUndo = useStore((state) => state.canUndo);
  const canRedo = useStore((state) => state.canRedo);
  const selectedPartId = useStore((state) => state.selectedPartId);
  const rotateSelected = useStore((state) => state.rotateSelected);
  const removeSelected = useStore((state) => state.removeSelected);
  const updatePartColor = useStore((state) => state.updatePartColor);
  const gridVisible = useStore((state) => state.gridVisible);
  const snapEnabled = useStore((state) => state.snapEnabled);
  const parts = useStore((state) => state.parts);
  const viewMode = useStore((state) => state.viewMode);
  
  const selectedPart = parts.find((p) => p.id === selectedPartId);
  const [showColorPicker, setShowColorPicker] = useState(false);
  
  const handleRotateLeft = () => {
    rotateSelected('y', -Math.PI / 2);
  };
  
  const handleRotateRight = () => {
    rotateSelected('y', Math.PI / 2);
  };
  
  const handleColorChange = (colorId: string) => {
    if (selectedPartId) {
      updatePartColor(selectedPartId, colorId);
    }
  };
  
  // 视角控制通过 OrbitControls 的 API
  const resetView = () => {
    // 通过派发事件或直接操作（简化：重新加载页面效果不佳）
    // 这里简单触发一个自定义事件，让 Scene3D 监听
    window.dispatchEvent(new CustomEvent('reset-camera'));
  };
  
  const zoomIn = () => {
    window.dispatchEvent(new CustomEvent('camera-zoom', { detail: { delta: -0.5 } }));
  };
  
  const zoomOut = () => {
    window.dispatchEvent(new CustomEvent('camera-zoom', { detail: { delta: 0.5 } }));
  };
  
  const toggleGrid = () => {
    useStore.setState({ gridVisible: !gridVisible });
  };
  
  const toggleSnap = () => {
    useStore.setState({ snapEnabled: !snapEnabled });
  };
  
  return (
    <div className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-1 shrink-0">
      {/* Logo/标题 */}
      <div className="flex items-center gap-2 mr-4">
        <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">
          🏗️
        </div>
        <div>
          <div className="font-bold text-gray-800 text-sm leading-tight">攀爬架设计器</div>
          <div className="text-[10px] text-gray-400 leading-tight">DIY 3D 搭建</div>
        </div>
      </div>
      
      <Divider type="vertical" className="h-6" />
      
      {/* 撤销/重做 */}
      <Tooltip title="撤销 (Ctrl+Z)">
        <Button
          type="text"
          icon={<UndoOutlined />}
          onClick={undo}
          disabled={!canUndo || viewMode === 'diff'}
          size="small"
        />
      </Tooltip>
      <Tooltip title="重做 (Ctrl+Y)">
        <Button
          type="text"
          icon={<RedoOutlined />}
          onClick={redo}
          disabled={!canRedo || viewMode === 'diff'}
          size="small"
        />
      </Tooltip>
      
      <Divider type="vertical" className="h-6" />
      
      {/* 保存/加载 */}
      <Tooltip title="保存方案">
        <Button
          type="text"
          icon={<SaveOutlined />}
          onClick={onSave}
          size="small"
        />
      </Tooltip>
      <Tooltip title="加载方案">
        <Button
          type="text"
          icon={<FolderOpenOutlined />}
          onClick={onLoad}
          size="small"
        />
      </Tooltip>
      
      <Divider type="vertical" className="h-6" />
      
      {/* 选中配件操作 */}
      <div className={`flex items-center gap-1 transition-opacity ${selectedPartId ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <Tooltip title="向左旋转 90° (Q)">
          <Button
            type="text"
            icon={<RotateLeftOutlined />}
            onClick={handleRotateLeft}
            disabled={!selectedPartId}
            size="small"
          />
        </Tooltip>
        <Tooltip title="向右旋转 90° (R)">
          <Button
            type="text"
            icon={<RotateRightOutlined />}
            onClick={handleRotateRight}
            disabled={!selectedPartId}
            size="small"
          />
        </Tooltip>
        
        {/* 颜色选择 */}
        {selectedPart && (
          <div className="relative">
            <Tooltip title="更换颜色">
              <Button
                type="text"
                icon={<BgColorsOutlined />}
                onClick={() => setShowColorPicker(!showColorPicker)}
                size="small"
              />
            </Tooltip>
            {showColorPicker && (
              <div className="absolute top-10 left-0 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-50 grid grid-cols-5 gap-1 w-32">
                {PART_COLORS.map((color) => (
                  <Tooltip key={color.id} title={color.name}>
                    <div
                      className={`w-6 h-6 rounded-full cursor-pointer border-2 transition-transform hover:scale-110 ${
                        selectedPart.colorId === color.id ? 'border-blue-500' : 'border-white'
                      }`}
                      style={{ backgroundColor: color.hex }}
                      onClick={() => {
                        handleColorChange(color.id);
                        setShowColorPicker(false);
                      }}
                    />
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
        )}
        
        <Tooltip title="删除配件 (Delete)">
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={removeSelected}
            disabled={!selectedPartId}
            size="small"
          />
        </Tooltip>
      </div>
      
      <div className="flex-1" />
      
      {/* 视角控制 */}
      <Tooltip title="放大">
        <Button type="text" icon={<ZoomInOutlined />} onClick={zoomIn} size="small" />
      </Tooltip>
      <Tooltip title="缩小">
        <Button type="text" icon={<ZoomOutOutlined />} onClick={zoomOut} size="small" />
      </Tooltip>
      <Tooltip title="重置视角">
        <Button
          type="text"
          icon={<VerticalAlignTopOutlined />}
          onClick={resetView}
          size="small"
        />
      </Tooltip>
      
      <Divider type="vertical" className="h-6" />
      
      {/* 辅助功能 */}
      <Tooltip title={gridVisible ? '隐藏网格' : '显示网格'}>
        <Button
          type={gridVisible ? 'primary' : 'text'}
          icon={<BorderOutlined />}
          onClick={toggleGrid}
          size="small"
          ghost={gridVisible}
        />
      </Tooltip>
      <Tooltip title={snapEnabled ? '关闭吸附' : '开启吸附'}>
        <Button
          type={snapEnabled ? 'primary' : 'text'}
          icon={<AimOutlined />}
          onClick={toggleSnap}
          size="small"
          ghost={snapEnabled}
        />
      </Tooltip>
    </div>
  );
}
