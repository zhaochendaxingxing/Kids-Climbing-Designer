import { useState, useMemo } from 'react';
import { Input, Collapse, Badge, Tooltip } from 'antd';
import {
  SearchOutlined,
  BarsOutlined,
  ApartmentOutlined,
  TableOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { PARTS_LIBRARY, CATEGORY_CONFIG, PART_COLORS, CONNECTOR_COLORS } from '@/data/parts';
import { useStore } from '@/store/useStore';
import type { PartCategory, PartDefinition } from '@/types/parts';

const { Panel } = Collapse;

const categoryIcons: Record<PartCategory, React.ReactNode> = {
  bar: <BarsOutlined />,
  connector: <ApartmentOutlined />,
  platform: <TableOutlined />,
};

interface PartCardProps {
  part: PartDefinition;
  onDragStart: (partId: string, colorId: string) => void;
}

function PartCard({ part, onDragStart }: PartCardProps) {
  const [selectedColor, setSelectedColor] = useState(part.defaultColor);
  const colorHex =
    (part.category === 'connector' ? CONNECTOR_COLORS : PART_COLORS).find((c) => c.id === selectedColor)?.hex || '#ccc';

  const handleClick = () => {
    onDragStart(part.id, selectedColor);
  };

  // 2D 预览图形样式（依据配件类型）
  const previewStyle: React.CSSProperties = (() => {
    if (part.category === 'bar') {
      return { width: 56, height: 10, borderRadius: 5, backgroundColor: colorHex };
    }
    if (part.category === 'connector') {
      return { width: 28, height: 28, borderRadius: '50%', backgroundColor: colorHex };
    }
    // 平台板
    const ratio = part.size.depth / part.size.width;
    return { width: 56, height: Math.max(18, Math.round(56 * ratio)), borderRadius: 3, backgroundColor: colorHex };
  })();

  return (
    <div
      className="p-3 bg-white rounded-lg border border-gray-200 cursor-pointer hover:border-blue-400 hover:shadow-md transition-all duration-200 group"
      onClick={handleClick}
    >
      {/* 配件预览 - 简化的 2D 图形 */}
      <div className="h-16 flex items-center justify-center mb-2 rounded bg-gray-50">
        <div
          className="transition-transform group-hover:scale-110"
          style={{ ...previewStyle, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
        />
      </div>
      
      {/* 配件名称 */}
      <div className="text-xs font-medium text-gray-700 truncate mb-1">{part.name}</div>
      
      {/* 尺寸 */}
      <div className="text-[10px] text-gray-400 mb-2">
        {part.size.width}×{part.size.height}×{part.size.depth}cm
      </div>
      
      {/* 颜色选择 */}
      <div className="flex gap-1 flex-wrap">
        {part.colors.slice(0, 5).map((color) => (
          <Tooltip key={color.id} title={color.name}>
            <div
              className={`w-4 h-4 rounded-full border-2 cursor-pointer transition-transform hover:scale-110 ${
                selectedColor === color.id ? 'border-blue-500 scale-110' : 'border-white'
              }`}
              style={{ backgroundColor: color.hex }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedColor(color.id);
              }}
            />
          </Tooltip>
        ))}
        {part.colors.length > 5 && (
          <div className="w-4 h-4 rounded-full bg-gray-100 text-[8px] flex items-center justify-center text-gray-500">
            +{part.colors.length - 5}
          </div>
        )}
      </div>
    </div>
  );
}

interface PartsLibraryProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function PartsLibrary({ collapsed, onToggle }: PartsLibraryProps) {
  const [searchText, setSearchText] = useState('');
  const [activeKeys, setActiveKeys] = useState<string[]>(['bar', 'connector', 'platform']);
  const setDraggingPart = useStore((state) => state.setDraggingPart);
  
  const handleDragStart = (partId: string, colorId: string) => {
    setDraggingPart({ partId, colorId });
  };
  
  // 按分类分组
  const partsByCategory = useMemo(() => {
    const result: Record<PartCategory, PartDefinition[]> = {
      bar: [],
      connector: [],
      platform: [],
    };
    
    const filtered = searchText
      ? PARTS_LIBRARY.filter(
          (p) =>
            p.name.toLowerCase().includes(searchText.toLowerCase()) ||
            p.description?.toLowerCase().includes(searchText.toLowerCase())
        )
      : PARTS_LIBRARY;
    
    filtered.forEach((p) => {
      result[p.category].push(p);
    });
    
    return result;
  }, [searchText]);
  
  if (collapsed) {
    return (
      <div className="h-full w-12 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-3">
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center hover:bg-blue-100 transition-colors"
        >
          <AppstoreOutlined />
        </button>
        {(Object.keys(CATEGORY_CONFIG) as PartCategory[]).map((cat) => (
          <Tooltip key={cat} title={CATEGORY_CONFIG[cat].name} placement="right">
            <div className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center hover:bg-blue-50 hover:text-blue-500 cursor-pointer transition-colors">
              {categoryIcons[cat]}
            </div>
          </Tooltip>
        ))}
      </div>
    );
  }
  
  return (
    <div className="h-full w-72 bg-white border-r border-gray-200 flex flex-col">
      {/* 标题栏 */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AppstoreOutlined className="text-blue-500" />
          <span className="font-semibold text-gray-700">配件素材库</span>
        </div>
        <button
          onClick={onToggle}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          收起
        </button>
      </div>
      
      {/* 搜索框 */}
      <div className="px-3 py-2">
        <Input
          placeholder="搜索配件..."
          prefix={<SearchOutlined className="text-gray-400" />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          size="small"
          className="rounded-lg"
        />
      </div>
      
      {/* 提示 */}
      <div className="px-4 py-2 bg-blue-50 text-xs text-blue-600 mx-3 rounded-lg mb-2">
        💡 点击配件添加到场景
      </div>
      
      {/* 分类列表 */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <Collapse
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(keys as string[])}
          ghost
          className="parts-collapse"
        >
          {(Object.keys(CATEGORY_CONFIG) as PartCategory[]).map((cat) => {
            const config = CATEGORY_CONFIG[cat];
            const parts = partsByCategory[cat];
            if (parts.length === 0) return null;
            
            return (
              <Panel
                key={cat}
                header={
                  <div className="flex items-center gap-2">
                    <span className="text-blue-500">{categoryIcons[cat]}</span>
                    <span className="font-medium text-gray-700 text-sm">{config.name}</span>
                    <Badge count={parts.length} size="small" className="ml-2" />
                  </div>
                }
              >
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {parts.map((part) => (
                    <PartCard
                      key={part.id}
                      part={part}
                      onDragStart={handleDragStart}
                    />
                  ))}
                </div>
              </Panel>
            );
          })}
        </Collapse>
      </div>
    </div>
  );
}
