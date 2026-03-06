type Lang = "en" | "zh";

const translations: Record<string, Record<Lang, string>> = {
  // ── Landing page ──
  "welcome.location": { en: "Long Island, New York", zh: "纽约长岛" },
  "welcome.title": { en: "our neighborhood, answered", zh: "我们的社区，有问必答" },
  "welcome.subtitle": {
    en: "codes, permits, events & more.",
    zh: "法规、许可、活动与更多。",
  },
  "welcome.selectVillage": {
    en: "Select your village to get started",
    zh: "选择您的村庄以开始",
  },
  "welcome.disclaimer": {
    en: "Information provided is for reference only. Always verify with official village resources for legal or permit-related matters.",
    zh: "所提供的信息仅供参考。有关法律或许可证相关事宜，请以官方村庄资源为准。",
  },

  // ── Events ──
  "events.upcoming": { en: "Upcoming Events", zh: "近期活动" },

  // ── Chat page ──
  "chat.village": { en: "Village:", zh: "村庄：" },
  "chat.searchWeb": { en: "Search web:", zh: "网络搜索：" },
  "chat.webOff": { en: "Off", zh: "关闭" },
  "chat.webLimited": { en: "5 max", zh: "最多5条" },
  "chat.webUnlimited": { en: "No limit", zh: "无限制" },
  "chat.changeVillage": { en: "Change village", zh: "更换村庄" },
  "chat.howCanIHelp": { en: "How can I help?", zh: "有什么可以帮您？" },
  "chat.emptySub": {
    en: "Ask about village codes, permit requirements, garbage schedules, snow removal rules, or anything about {village}.",
    zh: "询问有关{village}的村庄法规、许可证要求、垃圾收集时间、除雪规定或其他任何问题。",
  },
  "chat.q1": {
    en: "What are the garbage pickup days?",
    zh: "垃圾收集日是哪几天？",
  },
  "chat.q2": {
    en: "Do I need a permit for a fence?",
    zh: "安装围栏需要许可证吗？",
  },
  "chat.q3": {
    en: "What are the snow removal rules?",
    zh: "除雪规定是什么？",
  },
  "chat.q4": {
    en: "Village contact information",
    zh: "村庄联系方式",
  },
  "chat.connecting": { en: "Connecting...", zh: "连接中..." },

  // ── Chat input ──
  "input.placeholder": {
    en: "Can I add a fence? When is recycling pickup? What's the noise ordinance?",
    zh: "我能加围栏吗？回收日是哪天？噪音条例是什么？",
  },
  "input.imageAttached": { en: "Image attached", zh: "已附图片" },

  // ── Sidebar ──
  "sidebar.newChat": { en: "New Chat", zh: "新对话" },
  "sidebar.signInPrompt": {
    en: "Sign in to save your conversations",
    zh: "登录以保存您的对话记录",
  },
  "sidebar.signInGoogle": {
    en: "Sign in with Google",
    zh: "使用 Google 登录",
  },
  "sidebar.noConversations": {
    en: "No conversations yet",
    zh: "暂无对话",
  },
  "sidebar.today": { en: "Today", zh: "今天" },
  "sidebar.yesterday": { en: "Yesterday", zh: "昨天" },
  "sidebar.older": { en: "Older", zh: "更早" },

  // ── Theme ──
  "theme.light": { en: "Light", zh: "浅色" },
  "theme.dark": { en: "Dark", zh: "深色" },
  "theme.classic": { en: "Classic", zh: "经典" },

  // ── Nav ──
  "nav.chat": { en: "Chat", zh: "对话" },

  // ── Auth ──
  "auth.signIn": { en: "Sign in", zh: "登录" },
  "auth.signOut": { en: "Sign out", zh: "退出" },

  // ── Tier / Usage ──
  "tier.trialExhaustedTitle": {
    en: "Want to keep going?",
    zh: "想继续提问吗？",
  },
  "tier.trialExhaustedDesc": {
    en: "Each answer costs us real AI resources. We limit guest access so we can keep this free for the community. Get 10 more questions below, or sign in for unlimited access.",
    zh: "每次回答都会消耗AI资源。我们限制访客使用量，以便为社区持续提供免费服务。点击下方获取10次额外提问，或登录以获得无限使用。",
  },
  "tier.mustSignInTitle": {
    en: "You're part of the neighborhood",
    zh: "您是社区的一员",
  },
  "tier.mustSignInDesc": {
    en: "Sign in to keep asking questions, save your conversations, and get the most out of your community assistant. It only takes a second.",
    zh: "登录以继续提问、保存对话记录，并充分利用您的社区助手。只需一秒钟。",
  },
  "tier.getMoreQueries": {
    en: "Keep Asking",
    zh: "继续提问",
  },
  "tier.signInUnlimited": {
    en: "Sign in",
    zh: "登录",
  },
  "tier.dismiss": {
    en: "Maybe later",
    zh: "以后再说",
  },
  "tier.proOnly": {
    en: "Pro only",
    zh: "仅限 Pro",
  },
  "tier.promoBanner": {
    en: "Pro features active — {days} days remaining",
    zh: "Pro 功能已激活 — 剩余 {days} 天",
  },
  "tier.deepLocked": {
    en: "Deep mode requires Pro",
    zh: "深度模式需要 Pro",
  },
  "tier.unlimitedSearchLocked": {
    en: "Unlimited search requires Pro",
    zh: "无限搜索需要 Pro",
  },

  // ── Pipeline ──
  "pipeline.researching": { en: "Researching...", zh: "正在搜索..." },
  "pipeline.thinking": { en: "Thinking...", zh: "思考中..." },
  "pipeline.researched": {
    en: "Researched in {steps} steps, {searches} searches",
    zh: "共 {steps} 个步骤、{searches} 次搜索",
  },
  "pipeline.thought": {
    en: "Thought through {steps} steps",
    zh: "经过 {steps} 个步骤的思考",
  },
  "pipeline.foundResults": { en: "found results", zh: "找到结果" },
  "pipeline.noResults": { en: "no results", zh: "无结果" },
};

export default translations;
