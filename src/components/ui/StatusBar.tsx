import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { InfoCircleOutlined } from '@ant-design/icons';

export function StatusBar() {
  const parts = useStore((state) => state.parts);
  const selectedPartId = useStore((state) => state.selectedPartId);
  const hoveredPartId = useStore((state) => state.hoveredPartId);
  const draggingPart = useStore((state) => state.draggingPart);
  const gridVisible = useStore((state) => state.gridVisible);
  const viewMode = useStore((state) => state.viewMode);
  
  const selectedPart = parts.find((p) => p.id === selectedPartId);
  const hoveredPart = parts.find((p) => p.id === hoveredPartId);
  
  const [currentTime, setCurrentTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  const formatPosition = (pos: [number, number, number]) => {
    return `X: ${pos[0].toFixed(0)} Y: ${pos[1].toFixed(0)} Z: ${pos[2].toFixed(0)}`;
  };
  
  return (
    <div className="h-7 bg-gray-50 border-t border-gray-200 flex items-center px-4 text-xs text-gray-500 shrink-0">
      {/* 左侧：模式状态 */}
      <div className="flex items-center gap-3">
        {viewMode === 'diff' && (
          <span className="px-2 py-0.5 bg-purple-100 text-purple-600 rounded font-medium">
            对比模式
          </span>
        )}
        {draggingPart && (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-600 rounded font-medium">
            放置模式 - 点击地面放置
          </span>
        )}
        {selectedPart && (
          <span className="text-blue-600">
            已选中: {formatPosition(selectedPart.position)} cm
          </span>
        )}
        {hoveredPart && !selectedPart && (
          <span className="text-gray-600">
            {hoveredPart.partId.includes('connector') ? (
              <span>悬停转接头: {useStore.getState().getConnectorConnectionCount(hoveredPart.id)} 向连接</span>
            ) : (
              <span>悬停: {hoveredPart.partId} - {formatPosition(hoveredPart.position)} cm</span>
            )}
          </span>
        )}
        {!selectedPart && !draggingPart && viewMode === 'normal' && (
          <span className="flex items-center gap-1">
            <InfoCircleOutlined />
            从左侧选择配件添加到场景
          </span>
        )}
      </div>
      
      <div className="flex-1" />
      
      {/* 右侧：统计信息 */}
      <div className="flex items-center gap-4">
        <span>网格: {gridVisible ? '开' : '关'}</span>
        <span className="text-gray-400">|</span>
        <span>配件: <span className="font-medium text-gray-700">{parts.length}</span> 件</span>
        <span className="text-gray-400">|</span>
        <span>{currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}
