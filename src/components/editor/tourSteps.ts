import { TourStep } from "@/components/Tour";
import { Tab } from "./types";

// 新手引导的步骤文案：第一次进工作台自动播、顶栏「引导」可重看。
// 改讲解词、加一步、调顺序 → 只看这里。
// target 里的选择器必须与实际 DOM 对得上：页签按钮认 [data-tour="tab-*"]，
// 其余认 .chat-pane / .chat-stagebar / .chat-input / .editor-topbar——改类名前先搜这里。

/** 步骤要在讲解前切到对应页签，所以做成工厂：把页面的 openTab 传进来 */
export function buildTourSteps(openTab: (t: Tab) => void): TourStep[] {
  return [
    {
      title: "欢迎来到你的游戏工作室",
      body: "这里有一支常驻的 AI 团队：主策、剧情、人设、数值。你是老板——出想法、提方向、拍板，专业的活儿他们补全。花 1 分钟认认门，随时可以点右上角「引导」重看。",
    },
    {
      target: ".chat-pane",
      title: "左边：和团队聊",
      body: "整个创作过程就是在这儿聊出来的。说题材、说感觉、说你想要的结局，团队会反问、给方案、再动手搭建。不用懂代码，也不用学任何编辑器。中间那根竖线可以拖——想多看对话就往右拉，想多看预览就往左拉，双击复位。",
    },
    {
      target: ".chat-stagebar",
      title: "你现在走到哪一步",
      body: "创意对齐 → 方案确认 → 搭建 → 调优。条上高亮的就是当前阶段，右边写着此刻是哪几个职能在服务你——知道在跟谁说话，也知道下一步该聊什么。",
    },
    {
      target: ".chat-input",
      title: "想到什么就说什么",
      body: "一句话也行：「做个民国侦探，三个嫌疑人，结局至少五个」。想改也直接说：「中期太平了，加一场翻车」。Ctrl+Enter 发送。",
    },
    {
      target: '[data-tour="tab-preview"]',
      title: "预览试玩：随时开一局",
      body: "右边是你的工作区，六个页签。第一个「预览试玩」就是玩家看到的样子——改完立刻能玩，别只看设定，多玩几局最能发现问题。",
      onEnter: () => openTab("preview"),
    },
    {
      target: '[data-tour="tab-design"]',
      title: "设计卡：聊定的共识都在这",
      body: "题材基调、人物、玩法循环、数值、结局清单——团队边聊边记在这里。它是这款游戏的说明书，也是你检查「是不是我要的东西」的地方。",
      onEnter: () => openTab("design"),
    },
    {
      target: '[data-tour="tab-check"]',
      title: "校验：上线前的体检",
      body: "自动检查断头路、玩不到的结局、开局即死、数值越界这些坑，还能一键跑几百局模拟看结局分布。有错误时发布会被拦住——这是保证「你的游戏是完整的」的底线。旁边的「配置」页签是游戏的原始数据，想手动调也可以。",
      onEnter: () => openTab("check"),
    },
    {
      target: '[data-tour="tab-library"]',
      title: "内容库：别人的好点子可以搬",
      body: "官方与其他作者共享出来的桥段、事件、结局，按你的题材推荐给你，看中就装进自己的游戏——不用从零写每一段文字。",
      onEnter: () => openTab("library"),
    },
    {
      target: '[data-tour="tab-cover"]',
      title: "封面·素材：上传你的图",
      body: "封面可以自己传，也可以挑官方主题图。游戏里的立绘、场景图也在这上传，团队会建议放在哪一段最合适。愿意的话还能共享到公共素材库，帮别的作者一把。",
      onEnter: () => openTab("cover"),
    },
    {
      target: ".editor-topbar",
      title: "保存、发布、导出",
      body: "改动随时「保存」；觉得可以见人了就「发布」，拿到一条链接，谁点开都能直接玩、不用注册。「导出」把整份配置下载走——作品是你的，平台不锁人。",
    },
    {
      title: "就这些，开工吧",
      body: "记住一句话：你只管出想法，剩下的交给团队。卡住了就在左边直接问——「这段该怎么写」也是个好问题。",
    },
  ];
}
