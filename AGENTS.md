# AGENTS.md

## 项目概览

儿童攀爬架 DIY 3D 设计器 Web App，用户可以通过拖拽配件在 3D 空间中自由搭建攀爬架，并支持方案保存、对比和导出。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **3D 渲染**: 原生 Three.js（因 R3F 与 React 19 不兼容，已改用原生 Three.js + OrbitControls）
- **UI 组件**: Ant Design + shadcn/ui (预装)
- **状态管理**: Zustand
- **样式**: Tailwind CSS 4
- **图标**: @ant-design/icons

## 目录结构

```
src/
├── app/
│   ├── page.tsx              # 主页面（整体布局）
│   ├── layout.tsx            # 根布局
│   └── globals.css           # 全局样式
├── components/
│   ├── three/
│   │   └── Scene3D.tsx       # 3D 场景主组件（原生 Three.js，含内联配件建模+自动吸附）
│   ├── gizmo/
│   │   └── TransformGizmo.ts # 操作轴组件（纯 Three.js 类，独立封装）
│   └── ui/
│       ├── RightPanel.tsx    # 右侧功能菜单面板（窄竖条 icon 轨道 + 展开面板：配件库[基本配件/基本模块]/存储方案/统计信息/对比）⚠️ 当前唯一被 page.tsx 渲染的右侧面板
│       ├── WorkflowTab.tsx    # 模型左上角快捷工作选项卡（生成框架/增加框架/增加配件 三段式建模流程）⚠️ page.tsx 在 Scene3D 上叠加渲染
│       ├── PartsLibrary.tsx  # 遗留的配件素材库（内容已并入 RightPanel 的 BasicPartsGrid，当前未被引用）
│       ├── Toolbar.tsx       # 遗留顶部工具栏（未使用，工具栏逻辑已内联在 page.tsx）
│       └── StatusBar.tsx     # 底部状态栏
├── data/
│   └── parts.ts              # 配件数据库 + 预设单元（含 barSpec/connectorSpec/platformSpec）
├── store/
│   └── useStore.ts           # Zustand 全局状态管理
├── types/
│   └── parts.ts              # 类型定义（含分类专有参数类型）
└── lib/
    └── utils.ts              # 通用工具函数
```

## 核心功能

### 0. 整体布局（`page.tsx`）
- 顶部菜单区（通栏）：品牌「攀爬架DIY设计器」+ 副标题；撤销/重做 + **视角导航模式（移动视角/旋转视角，store `navMode`，点击进入后鼠标变图标、左键拖拽平移/旋转视角，再点退出）** + 居中视角；油漆桶（选色→点击杆件/平台板染色，store `paintColor`）+ 全选同类（弹出分类菜单选杆件/连接件/平台板→整类全选，随后统一/随机着色、统一调成六向或自动精简空闲连接端）+ 吸附 ON/OFF；已选中 N 件 + 导出(JSON)。**注意：移动/生长模式（store `gizmoMode`）已不在顶部，集成进左上角 WorkflowTab 四按钮。**
- 主体：左侧 `flex-1` = `Scene3D` 工作区；右侧 = `RightPanel` 功能菜单面板。
- 配色遵循 `DESIGN.md`（天空蓝 #4A90D9 主色、阳光橙 #FF9F43 强调、圆角胶囊、柔和阴影）。

### 0.1 四按钮工作流（`WorkflowTab.tsx` + store `workflow` / `gizmoMode`）
- **左上角快捷工作选项卡**（`WorkflowTab`，`page.tsx` 在 Scene3D 工作区上叠加渲染，`absolute top-3 left-3 z-30`），四个按钮把原「移动模式/生长模式」与三段式建模流程集成在一起：
  - **生成框架（spec）**：按钮激活条件 `workflow==='spec' && gizmoMode==='growth'`；点击 → `setWorkflow('spec') + setGizmoMode('growth')`。下方操作区输入 层高/列宽/纵深（格子数，默认 3/2/2），点击「生成框架」→ 调 store `generateFramework(layers,cols,depth)` 自动生成多层立体框架（节点用「立六通」连接件、沿 X/Z/Y 三向铺 35CM 圆管，cell = 40cm 边长）。**颜色自动分配：圆管 = 橄榄绿 `olive`，连接件 = 黑色 `black`**。**spec 阶段一切自动生长（杆件/连接件扩展幽灵 + 平台板 Auto-ghost）全部关闭**（两者均按 `workflow==='spec'` 禁用，若要生长必须切到后续阶段）。
  - **增加框架（frame）**：激活条件 `workflow==='frame' && gizmoMode==='growth'`；点击 → `setWorkflow('frame') + setGizmoMode('growth')`（即默认生长模式）。**仅允许编辑与自动生长杆件、连接件**：生长模式扩展幽灵照常（杆/连接件端延伸、链式搭架）；平台板 Auto-ghost 被禁；直接拖拽放置的平台板/扩展板件被拒绝（`Scene3D` 放置分支按 `workflow==='frame'` 拦截非法分类并清掉 draggingPart）。
  - **增加配件（accessory）**：激活条件 `workflow==='accessory' && gizmoMode==='growth'`；点击 → `setWorkflow('accessory') + setGizmoMode('growth')`（默认生长模式，平台板 Auto-ghost 需要 growth）。此阶段添加平台板「封面」并右键可替换同类。**生长模式不再识别杆件/连接件生长端**（扩展幽灵被禁），**仅激活面板生长逻辑**（平台板 Auto-ghost 生效，`Scene3D` 平台 ghost 仅 `workflow==='accessory'` 出 ghost）。
  - **移动配件（move）**：激活条件 `gizmoMode==='move'`（与 workflow 正交，任何阶段均可）；点击 → `setGizmoMode('move')`（不改 workflow）。选中物件显示操作轴，可自由移动/旋转，不显示任何扩展幽灵；操作区统一显示 move 提示（优先于阶段提示）。
- 点击任一按钮都会先清掉油漆桶（`setPaintColor(null)`）与全选同类弹出层。
- `setWorkflow(w)` 本身只改 `workflow` 不强制联动 `gizmoMode`；`workflow` 初始 `'spec'`、`gizmoMode` 初始 `'growth'`。Scene3D 中切到 accessory 阶段时若需保证 growth 由按钮点击保证（store 旧联动已移除）。

### 1. 右侧功能菜单面板（`RightPanel.tsx`）
- **窄竖条 icon 轨道**（常驻最右 `w-12`）：配件库 / 基本模块 / 存储方案 / 统计信息 + 收起按钮；点击展开对应面板。
- **展开主面板**（`w-[340px]`）含标题栏（对比按钮）+ 滚动内容区，三块内容：
  - **配件库**（含「基本配件 / 基本模块」子切换 + 对比）：
    - 基本配件 = `BasicPartsGrid`（杆件 15/35、连接件、平台板 + 颜色选择，点击 → `setDraggingPart`）
    - 基本模块 = `PresetsPanel`（拖出/点击部署预设模块）
  - **存储方案** = `ProjectsPanel`（新建/保存/重命名/复制/删除/对比）
  - **统计信息** = `PartsSummary`（计数卡 + 用料构成 + 分类明细 + 导出 JSON/CSV）
- `viewMode === 'diff'` 时面板自动切换为 `DiffPanel`（版本对比），标题变成「版本对比」，对比按钮变为「退出」。
- 面板收起状态由 `page.tsx` 的 `panelCollapsed` 控制，仅显示窄竖条轨道。

### 2. 3D 搭建空间 (`Scene3D.tsx`)
- 原生 Three.js 渲染（非 R3F）
- 10cm 网格吸附
- 配件点击选中、旋转、删除
- 碰撞检测（AABB）
- 视角控制：**左键**选择/拖拽/放置（Scene3D 处理），**中键拖拽**旋转视角、滚轮缩放，**右键**平移/上下文菜单（OrbitControls）
- **视角导航模式（`navMode`：none/pan/rotate）**：顶部「移动视角」/「旋转视角」按钮点击进入（再点退出），激活时鼠标变成对应图标（平移=小手 grab、旋转=旋转箭头自定义 cursor），**左键拖拽**交由 OrbitControls 平移/旋转视角；Scene3D 的 `onPointerDown`/`onPointerMove`/`onPointerUp` 在 `navMode!=='none'` 时提前 return，不进入选中/拖拽/幽灵逻辑；进入导航时自动清除油漆桶与全选同类激活态（`setNavMode`）。本地 `viewMode` 为版本对比(diff) 专用，勿与导航模式混淆
- 键盘快捷键支持

### 3. 配件渲染（`Scene3D.tsx` 内联 `createPartMesh`）
- **杆件**：中空圆管（LatheGeometry 生成管壁，内径 4cm，壁厚 2mm，外径 4.4cm），轴线沿 X 轴
- **连接件**：中心球体（直径 5cm）+ 多向接口套筒（直径 4cm，插入深度 4cm），套筒沿 `connectionPoints.direction` 方向延伸
  - **嵌套套筒（female）渲染**：`createPartMesh` 中 female 端（嵌套套筒）为**空心管口**：按 45度两通工程图尺寸 **内径 4cm / 外径 5cm / 壁厚 0.5cm**（`NEST_SOCKET_OUTER_DIAMETER=5`、`NEST_SOCKET_INNER_DIAMETER=4`），用于套住 male 凸头（外径 4cm）。两端长度一致、不额外加深，保证 45°L 嵌套件贴合面一致、无多余短柱外露（仅视觉，连接点几何 `CONN_POINT_DIST` 不变，不影响吸附/贴合）。
  - **45°L嵌套组合**（`COMBO_45L`，`combo-45l`）：**基本配件库**（连接件分类）中的一体卡片，由两个**独立连接件**嵌套组成：
    - 子件 `connector-45deg-nest`（45度两通·嵌套端）在**左**：其 `x+` 端为 **female 嵌套套筒端（空心管口，内径 4cm / 外径 5cm）**，朝 **+X 水平向右**；`up45` 端为正常 male 端，与其成 **45° 锐角**朝**右上方**（`D45`）。
    - 父件 `connector-l`（L两通）在**右**，绕 **Z 轴旋转 π**：其 `x+` male 端经旋转朝 **-X 水平向左**，与 45 度件 `x+` female 套筒贴合（嵌套）；其 `y+` male 端经旋转朝 **-Y 竖直向下**（立杆）。
    - 二者以水平嵌套形态排布，随组部署并自动成组（组名=组合名）。`connector-45deg-nest` 渲染时 female 端为**空心管口（内径 4cm / 外径 5cm / 壁厚 0.5cm，轴向长 `NEST_SOCKET_LENGTH=5cm`）**，仍为独立单球件。**该件不作为独立配件展示/选择**（仅在 `COMBO_45L` 内部使用，`BasicPartsGrid` 过滤 `connector-45deg-nest`）。
  - **45°L嵌套贴合成组**（`COMBO_45L`，`combo-45l`）：`connector-45deg-nest` 的 x+ female（空心管口，朝右）连接 `connector-l` 的 x+ male（绕Z轴π旋转后朝 -X）。**嵌套贴合深度由 `parts.ts` 的 `COMBO_NEST_K`（cm）统一控制**：45度件 x+ 贴合点 = `[CONN_POINT_DIST-COMBO_NEST_K,0,0]`、L件 position = `[5-COMBO_NEST_K,3.2,0]`，两件贴合点恒重合（自洽）。`K` 增大→male 更深套入 female、组合横向更紧凑（W1 减小）；`W2` 基准 = 35cm杆 + 2个L件嵌套 = `2*(35/2 + CONN_POINT_DIST) = 40`。**默认 `COMBO_NEST_K = 1.0`**。修改 `COMBO_NEST_K` 即可调屋顶跨度 W1 对齐 W2（两球心距 = `5 - K`，K 上限约 1.6 避免中心球过度交叠）。
  - **45度件**（`connector-45deg`，独立单球）：单球（中心直径 5cm）通用连接件渲染。**水平端为 male 凸头（`x+` 朝右，接 L 件，凸头长度仅 `socketLength=4cm`）**；**斜向端为 female 嵌套套筒（`up45` 朝左上 `D45_NEG`，轴向长 `NEST_SOCKET_LENGTH=5cm`，用于嵌套杆件）**。端口类型按工程图：水平端实心 male、斜向端 female 套筒嵌杆件。走通用球+套筒分支（`createPartMesh`）。
- **平台板**：BoxGeometry 平板（厚 2cm）+ 四周折边（高 2cm，厚 0.4cm），折边向下突出
- **收纳盒（`ext-plate-storbox`）**：敞口方槽，**盒身外沿 36cm（`size`=36×36×15）可落入 1x1 框架内缘（杆件中心距 40cm − 外径 4.4cm = 35.6cm）** + 顶部翻边（厚 1cm，`flangeWidth` 单边 3cm，翻边总宽 = 36+6 = 42cm，外缘 21cm 越过杆件中心轴 20cm 卡住）+ 两侧边耳（提手）。渲染为四壁 + 底板 + 翻边四周一圈 + 边耳。
  - **卡扣吸附（`findPlatformSnap` 特判）**：收纳盒检测到矩形框架（边长容差 `edgeLen+10`）时不走「躺在杆顶」，而是**整体下沉卡入框架**：翻边底面落在杆件**顶面**（`posY = centerY + barR − 0.4`，barR=2.2），盒身垂在框架内侧；水平位置取矩形中心，旋转对齐杆件实际轴向（框架旋转任意角度都跟随）。拖拽新件、移动已有件两条路径均生效。
  - 平台板（无 `flangeWidth`）仍走原「躺在杆顶」逻辑（`posY = centerY + barR + plateThickness/2 − 0.2`）。
- 选中/悬停高亮（EdgesGeometry 描边）
- 幽灵预览（拖拽时半透明）
- 对比模式高亮（新增绿色/删除红色）

### 3.1 自动吸附（`Scene3D.tsx` 内联 snap 函数）
- **连接点类型**：`male`（凸头，连接件的套管）/ `female`（凹口，杆件的两端管口）
- **杆件 ↔ 连接件双向吸附**：拖拽或放置时，检测附近异性连接点（距离 < 6cm，方向夹角 < 15°），自动对位+对旋
- **平台板吸附矩形框架**：`findPlatformSnap` / `findPanelFit` 均采用**方向无关的矩形枚举**——任取附近 4 根杆件做 3 种配对，找"两对平行 + 两对垂直 + 4 杆共面/同层 + 两对对边中点重合"的矩形，边长/中心/旋转全部从杆件实际世界轴向算出（`basisEuler` 构造姿态），**不依赖世界 X/Y/Z 轴，框架绕 Y 旋转任意角度都能正确识别与贴合**。自动吸附居中，按边长匹配平台型号（允许宽深 swap）
- 吸附触发时机：拖拽过程中实时吸附 + 放置新零件时吸附
- 核心函数：`getWorldConnPoints`、`findBestSnap`、`computeSnappedTransform`、`findPlatformSnap`

### 4. 状态管理 (`useStore.ts`)
- 场景配件管理（增删改查）
- 撤销/重做（50 步历史）
- 方案管理（localStorage 持久化）
- 版本对比
- 导出 JSON/CSV

### 5. 方案管理 (`RightPanel.tsx` - projects tab)
- 新建/保存/加载/删除/重命名/复制方案
- localStorage 存储

### 6. 版本对比 (`RightPanel.tsx` - diff tab)
- 新增配件（绿色高亮）
- 删除配件（红色高亮）
- 数量变化（黄色）

### 7. 基本模块库 (`RightPanel.tsx` - 组合 tab / `PRESET_UNITS`)
- 预设单元定义为「可直接拖出部署的预制组元素」：每个 `PresetUnit` 含 `name/描述 + 一组相对坐标的 parts`。
- 首个模块「正方形爬架底框」：4 根 35CM 圆管 + 4 个十字四通连接件组成的闭合方形框架。
- **组合成员生长放行**：生长模式的扩展幽灵守卫默认跳过成组物体，但「45°L嵌套组合」成员例外——组合组放行，嵌套端由 `findBestSnap` 自动判定占用（male↔female 贴合），其余端可继续生长杆件。
- 交互：右键面板卡片可**拖出或点击**进入放置模式（store `pendingPreset`），鼠标在场景悬停显示模块半透明幽灵，点击地面将整组部件以 `addPresetGroup` 一次性部署并**自动成组**（复用 `toggleGroup`）+ 以模块名命名，随后可整体选中移动；Esc 取消。
- 悬停幽灵复用 `ghostPosition`/`ghostGroupRef`：对 `pendingPreset` 的每个部件按相对偏移 `createPartMesh`，外层 Group 定位到 `ghostPosition`。

### 8. 元件编辑与端点扩展 (`Scene3D.tsx`)
- **右键菜单**（增强）：
  - 「更换颜色」：取当前元件定义 `def.colors` 色板渲染圆形色块，点击 → store `updatePartColor`。
  - 「替换为同类型」：遍历 `PARTS_LIBRARY` 中同 `category` 的元件（杆件互换 / 连接件互换），点击 → store `replacePart`（保留 position/rotation，颜色可保留则保留，否则回退新件 `defaultColor`，并计入历史）。列表过滤 `connector-45deg-nest`；连接件额外提供「45°L嵌套组合」项，点击删旧件后以原位置为锚点部署组合。
  - **板件类（platform，不含收纳盒 storbox）专属「配件编辑」功能栏**：与「更换颜色」「替换为同类型」并列，包含「镜像」「成组/取消成组」「删除」三项；板件菜单不再显示底部通用的成组/删除按钮（杆件/连接件仍走底部通用项）。
    - 「镜像」：`mirrorPlatformTransform(part, def, allParts)` **先识别与平台板四边相交接的 4 根杆件构成的矩形平面作为镜面，再依该平面方向镜像**（不使用板自身本地轴/世界固定轴，框架整体旋转任意角度、板手动放置朝向有偏差都不会错位）：枚举附近杆件（24 根内）→ 任取 4 根尝试 3 种配对找出"两对平行 + 互相垂直"→ 校验 4 杆共面（法向距离 <4）→ 8 端点并查集聚类成 4 角点（异杆端点距离 <8 合并）→ 角点方位角排序后校验邻边垂直（点积 <0.15）、对边等长（<6）、宽深与板 sizeMatch（容差 10，允许 swap）→ 板中心在镜面内（法向距离 <5）、板法线与镜面法线点积 >0.8、中心距离 <18，取中心最近者。变换：位置对镜面（过矩形中心）做平面反射 `newPos = pos - 2*((pos-center)·n)*n`；姿态绕**镜面内铰链轴**转 180°（视觉等价反射的合法刚体旋转），铰链轴 = 世界竖直方向在镜面内的投影（保证翻转后上下不倒），镜面近水平时退化为镜面内 u 边方向；世界系轴用四元数左乘。通过 store `updatePartTransform` 一次性写入并计入历史；找不到相接杆件矩形才 alert。收纳盒为不对称敞口容器不支持镜像。
- **右键替换为45°L嵌套组合（Scene3D 内联右键菜单）**：删除当前连接件后，以旧件位置为锚点部署组合（`addPresetGroup`）。**注意 dropPos 必须减去组合件内置 y 偏移 3.2**（`cmbY = COMBO_45L.parts[0].position[1]`），否则组合整体被抬高 3.2cm 悬空、无法与杆件对接。部署后对组合做**结构化刚体吸附**（`snapComboRigid`）：组合是「斜杆端 up45(仰角45°) + 立杆端(竖直向下)」的结构形态，**只允许绕世界 Y 轴水平旋转 + 整体平移**，以组合 male 端为锚对齐周围杆件 female 端（`setFromUnitVectors` 求水平朝向上的唯一绕 Y 旋转），锚定后 `batchUpdate` 整体应用，并通过 `findBestSnap` 统计对接端口数优选出最多闲置端与杆件真实对接的方案。这样保证**立杆始终竖直、斜杆保持45°仰角**，仅水平镜像匹配屋顶左右两侧，避免被任意 3D 旋转扭转成横向横杆。
- **从配件库部署 `COMBO_45L`（拖出/点击 pendingPreset → Scene3D 放置分支）**：`addPresetGroup` 之后同样对组合执行上述 `snapComboRigid` 结构化刚体吸附（按 `preset.id === COMBO_45L.id` 判定、`selectedIds` 为两件时触发），保证从库中放入的组合也能自动贴合周边斜杆/立杆、立杆竖直、斜杆45°，与右键替换路径行为一致（避免右侧斜杆悬空错位）。
- **端点扩展幽灵**（store `extendExtensionPoint` 无关，纯 Scene3D）：
  - **受模式控制（store `gizmoMode`）**：仅 `'growth'`（生长模式）显示扩展幽灵；`'move'`（移动模式）仅显示操作轴、不显示幽灵。切换模式立即重建/清除。
  - **平台板自动幽灵（生长模式）**：pointermove 时仅当 `workflow==='accessory'`（增加配件）阶段触发，用 `findPanelFit` 做**方向无关**矩形检测（取光标 75cm 内最近 16 根杆件，任取 4 根做 3 种配对找两对平行且垂直、共面、中点重合的杆件，不假设世界轴），同时支持**水平顶面**与**垂直立面封板**，框架整体旋转任意角度都能识别；姿态用杆件实际轴向经 `basisEuler` 构造，并按框架边长（容差 13）从 `PARTS_LIBRARY` 匹配最合适的平台型号（如 `platform-39.5x39.5` / `platform-39.5x19.5`，允许宽深 swap）；spec/frame 阶段从 pointermove 调用点(`workflow==='accessory'`)与更新函数(`workflow!=='accessory'`)双层拦截，绝不出现平台板 ghost：
    - 水平平台：`posY = 中心Y + 杆半径 + plateThickness/2 - 0.2` 躺在顶面，rotation 用 `basisEuler(宽边, (0,1,0), 深边)`；
    - 立面封板（`|法线.y| < 0.5`）：宽沿水平边、高沿竖直边、厚沿墙面法线，`basisEuler(水平边, 法线, 竖直边)`，position=框架中心；
    - 半透明幽灵存 `platGhostGroupRef` + `platGhostDataRef`（型号/位置/rotation 未变跳过重建），命中型号存入 `platGhostPartIdRef`；点击幽灵 → `addPart(platGhostPartIdRef.current || 'platform-39.5x39.5',…)` 部署并选中。已存在平台板的位置去重不提示。与扩展幽灵互不影响。`basisEuler` 为核心辅助：施密特正交化 + 右手系校正，把两组正交基 → Euler。
  - 选中**单个独立非成组**的杆件或连接件时，在其**空闲扩展连接端**显示半透明待部署元件（复用 `ghostGroupRef` 旁的独立 `extGhostGroupRef` + `extGhostDataRef`，`computeExtensionGhosts` 计算）：
    - 杆件（female 两端管口）空闲端 → 幽灵「立六通」`connector-v6`
    - 连接件（male 套管）空闲嵌套端 → 幽灵杆件 `bar-35`
  - 已与实体元件建立连接（可吸附到异性连接点）的部位**不**生成幽灵（用 `findBestSnap` 判定占用）。
  - 幽灵生成基于 `computeSnappedTransform` 吸附定位；点击幽灵 → 对整组递归射线检测 `intersectObject(group,true)` 并沿父子链回溯带 `extGhostIndex` 的分组取部署数据 → `addPart(..., skipCollision=true)` 部署并 `setSelection([新件])`，实现**链式扩展**。
  - 条件守卫：拖拽中/放置中(`draggingPart`/`pendingPreset`/`dragState.dragPartId`)、成组物体、多选、非杆件/连接件均不显示。
  - 生长模式下操作轴被隐藏（`gizmo.visible=false`），因此不会拦截幽灵点击。
- **一键批量编辑（store + 点选模式）**：
  - `paintColor`/`setPaintColor`：油漆桶选色；Scene3D pointerdown 若 `paintColor` 已设，命中杆件/平台板则 `paintPart` 染色并 return（不触发选中/拖拽/操作轴）。上色模式为独立模式：`paintColor` 非空时 Scene3D 隐藏操作轴与扩展幽灵，与移动/生长模式互斥（模式按钮高亮需 `!paintColor`）。
  - **全选同类·分类菜单（`page.tsx` 弹出层 + `selectByCategory`）**：点击顶部「全选同类」即时取消移动/生长/上色（三者弹起），弹出分类菜单（与“基本配件”分项一致的 杆件/连接件/平台板，并显示各自计数）；选择某分类 → `selectByCategory(分类)` 整类全选；随后同一弹出层自动切换为该分类的“统一调整”面板：
    - 杆件/平台板：统一着色（PART_COLORS 色板）＋杆件可随机上色；
    - 连接件：统一调成六向连接件（`replaceSelectedConnectors('connector-v6')`）或按接线自动精简空闲连接端（`optimizeSelectedConnectors`）。
  - `selectByCategory(category)`：按分类全选同类（选中原始 parts）。
  - `paintSelected(colorId)` / `randomColorSelected()`：对选中杆件/平台板统一或随机上色（计入历史）。
  - `replaceSelectedConnectors(partId)`：选中连接件一键替换（保留 position/rotation，颜色兼容则保留）。
  - `optimizeSelectedConnectors()`：先以 `connectorUsedWorldDirs`（对每个连接件接口，检测是否有杆件端头贴合于其接口面，容差 5）得到被占用接口的**世界方向集合**；再以 `findOptimizedConnector` 在所有轴向连接件中找一个**接口数与实连杆数一致、且可通过 24 种旋转（`ROT24`/`matchDirsToUsed`）把自身接口精确对齐到这些方向**的型号（如十字四通接 2 根垂直杆→L 两通、立六通接 3 杆→立三通……），替换时写入该旋转使接口贴合杆件、保留颜色，计入历史。
  - 连接件颜色为黑色单色，批量替换/优化仅改变 `partId`，不破坏成组（组的 `memberIds` 无关 partId）。

## 开发命令

```bash
pnpm install    # 安装依赖
pnpm dev        # 启动开发服务器
pnpm build      # 生产构建
pnpm start      # 启动生产服务器
pnpm ts-check   # TypeScript 类型检查
pnpm lint       # ESLint 检查
```

## 关键设计决策

1. **坐标系统**：使用厘米 (cm) 作为世界单位，配件尺寸直接使用厘米数值
2. **网格吸附**：10cm 网格，放置和移动时自动吸附
3. **碰撞检测**：简化为 AABB 包围盒检测，Y轴旋转90度时交换宽深
4. **撤销/重做**：基于 parts 数组快照的历史记录，最多 50 步
5. **数据持久化**：方案数据存储在 localStorage，key 为 `climbing-frame-projects`
6. **嵌套式连接**：连接件套管（凸头，直径 4cm）插入杆件内径（凹口，内径 4cm），壁厚 2mm
7. **连接点类型**：ConnectionPoint.type = 'male' | 'female'，吸附时自动配对
8. **自动吸附判定**：距离阈值 6cm + 方向夹角阈值 15°

## 扩展点

- 可接入淘宝配件真实数据（修改 `src/data/parts.ts` 中的 `PARTS_LIBRARY`）
- 可增加更多配件类型
- 可增加多人协作功能
- 可增加 AR/VR 预览

## 常见问题

### 3D 场景报错
- 3D 渲染使用原生 Three.js（`Scene3D.tsx`），不依赖 R3F
- 注意 'use client' 指令（3D 组件必须客户端渲染）
- 连接件为 Group（中心球体 + 接口套筒），若渲染异常检查 `createPartMesh` 与 `def.connectionPoints`

### 拖拽添加配件
- 点击左侧配件卡片进入放置模式，点击地面放置
- 按 ESC 取消放置

### 键盘快捷键
- `Delete/Backspace`: 删除选中配件（支持多选批量删除）
- `R`: 选中配件 Y 轴旋转 90°（支持多选）
- `Q`: 选中配件 Y 轴反向旋转 90°（支持多选）
- `Ctrl+Z`: 撤销
- `Ctrl+Y` / `Ctrl+Shift+Z`: 重做
- `Esc`: 取消选中/取消放置
- `G`: 已选对象成组/解组

### 多选与框选
- `Ctrl/Shift + 点击`: 切换加入/移出多选；普通点击单选
- 空白处拖拽左键框选：
  - 左上→右下（正向）：物体必须**完整位于**选框内才被选中
  - 右下→左上（反向）：物体**部分相交**即可被选中
- `Alt + 点击/拖拽` 已有物件：在原位生成一个静止副本作为部署锚点；被操作的原物体成为拖拽目标，拖拽期间若与副本（或任何其他部件）体积碰撞则以红色半透明“幽灵”显示，脱离碰撞后变回实体；松开时若仍碰撞则自动弹开到最近空闲位置（`findFreeSpawn`）；携带动线期间不联动原物体所在组（`!ds.ghostActive` 守卫）。
- 右键点击已选物件：弹出上下文菜单（成组/取消成组/删除）。**成组物体视为一个全新物件**：右键命中任一成组成员即视为选中整个组，菜单显示「取消成组」；未成组时显示「成组」。
- **操作轴旁的「组信息」标签**：选中落在同一个多成员组内时，操作轴(gizmo)上方浮现一个小标签，显示组名，并提供「✎ 重命名组」与「解组」快捷按钮（`SceneGroup.name` + store `renameGroup`）。重命名输入框支持 Enter 确认 / Esc 取消 / 失焦确认。
- 多选后按 `G` 或右键菜单「成组」可合并为一组；成组后可整体拖拽移动
- **撤销为单步完整操作**：移动/旋转/复制各视为一次操作，拖动开始时记录一次历史快照（`historyPushed` 防重复 / `altCopy` 跳过额外记录），`Ctrl+Z` 回到上一步完整操作

### 成组机制
- 组存储在 store `groups: SceneGroup[]`，每个 group 记录 `memberIds`（配件平铺存储）+ `childGroupIds`（支持**嵌套子组**）
- **嵌套成组**（`toggleGroup`）：选中的顶层单元（整组或独立零件）合并成新父组；选中恰好等于某顶层组的全部后代时则**解组一层**（成员/子组恢复到该次成组前状态）。**成组物体未加入新（独立未成组）物体时不可再次成组**：若选中内容里没有独立的未成组零件，再次成组为无效操作，直接忽略。
- **操作轴几何中心**：多选/成组时 gizmo 定位到所有零件的 AABB 几何中心（Scene3D 通过 `collectSelectionIds` 递归展开顶层组）
- **成组蓝色线框包围盒**：选中成组/多选物体时，用一个蓝色 3D 线框立方体（`selBoxRef` / `getSelAABB`）框住所有组员，便于区分成组与单一物体
- 整组移动/旋转（gizmo 轴/平面/弧）：递归展开后代，围绕几何中心整体变换，保持相对位置；r/q 键整体旋转同理
- **成组移动为刚体变换**：成组物体视为不可撼动的 solid 完整实体，整个拖拽手势中所有成员始终使用「起始位置 + 统一位移」的绝对变换（`ds.rigidSnap` 起始快照 + 对位移取整网格吸附 + 一次 `batchUpdate` 原子更新），从根本上杜绝逐帧增量叠加导致的相对位移
- **成组弧长旋转防漂移**：弧旋转开始时对组员记录变换快照（`ds.groupSnap`/`groupAnchor`），每次移动基于快照做**绝对**旋转，避免累加漂移
- **组地面碰撞**：以组内最低物体（含旋转 AABB，`getSelAABB`）的底部为边界整体均匀上移，不破坏相对位置（`clampGroupToGround` / Scene3D 内联逻辑）
- **Alt 复制**：按住 Alt 拖拽物体或操作轴（移动/旋转）都会先复制当前选中（单件或整组，含嵌套结构），再对副本执行操作（`duplicateSelection`）
- 工具函数：`collectGroupPartIds` / `getTopGroupOf` / `computeCenter` / `clampGroupToGround`（store 模块级导出）
- 删除成员会从所在组移除该成员，空组自动清理
