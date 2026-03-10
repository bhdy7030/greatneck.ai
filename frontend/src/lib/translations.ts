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
  "events.noEvents": { en: "No events in this category", zh: "该分类暂无活动" },
  "events.now": { en: "Now", zh: "现在" },

  // Event categories
  "events.cat.school": { en: "School", zh: "学校" },
  "events.cat.student": { en: "Student", zh: "学生" },
  "events.cat.kids": { en: "Kids", zh: "儿童" },
  "events.cat.teens": { en: "Teens", zh: "青少年" },
  "events.cat.family": { en: "Family", zh: "家庭" },
  "events.cat.art": { en: "Art", zh: "艺术" },
  "events.cat.entertainment": { en: "Art & Entertainment", zh: "艺术与娱乐" },
  "events.cat.food": { en: "Food", zh: "美食" },
  "events.cat.festival": { en: "Festival", zh: "节日" },
  "events.cat.health": { en: "Health", zh: "健康" },
  "events.cat.education": { en: "Education", zh: "教育" },
  "events.cat.community": { en: "Community", zh: "社区" },
  "events.cat.general": { en: "Event", zh: "活动" },

  // Event sources
  "events.src.patch": { en: "Patch", zh: "Patch" },
  "events.src.longisland": { en: "LI Events", zh: "长岛活动" },
  "events.src.eventbrite": { en: "Eventbrite", zh: "Eventbrite" },
  "events.src.islandnow": { en: "Island Now", zh: "Island Now" },
  "events.src.library": { en: "GN Library", zh: "大颈图书馆" },
  "events.src.school": { en: "GN Schools", zh: "大颈学校" },
  "events.src.village": { en: "Village", zh: "村庄" },
  "events.src.parkdistrict": { en: "Park District", zh: "公园管理区" },

  // Source filter labels
  "events.filter.library": { en: "Library", zh: "图书馆" },
  "events.filter.school": { en: "Schools", zh: "学校" },
  "events.filter.village": { en: "Village", zh: "村庄" },
  "events.filter.patch": { en: "Patch", zh: "Patch" },
  "events.filter.longisland": { en: "Long Island", zh: "长岛" },
  "events.filter.eventbrite": { en: "Eventbrite", zh: "Eventbrite" },
  "events.filter.parkdistrict": { en: "Park District", zh: "公园管理区" },
  "events.filter.other": { en: "Other", zh: "其他" },

  // Date ranges
  "events.range.all": { en: "All", zh: "全部" },
  "events.range.today": { en: "Today", zh: "今天" },
  "events.range.tomorrow": { en: "Tomorrow", zh: "明天" },
  "events.range.weekend": { en: "Weekend", zh: "周末" },

  // Date labels
  "events.date.today": { en: "Today", zh: "今天" },
  "events.date.tomorrow": { en: "Tomorrow", zh: "明天" },

  // Weekdays
  "events.weekday.0": { en: "Sun", zh: "周日" },
  "events.weekday.1": { en: "Mon", zh: "周一" },
  "events.weekday.2": { en: "Tue", zh: "周二" },
  "events.weekday.3": { en: "Wed", zh: "周三" },
  "events.weekday.4": { en: "Thu", zh: "周四" },
  "events.weekday.5": { en: "Fri", zh: "周五" },
  "events.weekday.6": { en: "Sat", zh: "周六" },

  // Months
  "events.month.0": { en: "Jan", zh: "1月" },
  "events.month.1": { en: "Feb", zh: "2月" },
  "events.month.2": { en: "Mar", zh: "3月" },
  "events.month.3": { en: "Apr", zh: "4月" },
  "events.month.4": { en: "May", zh: "5月" },
  "events.month.5": { en: "Jun", zh: "6月" },
  "events.month.6": { en: "Jul", zh: "7月" },
  "events.month.7": { en: "Aug", zh: "8月" },
  "events.month.8": { en: "Sep", zh: "9月" },
  "events.month.9": { en: "Oct", zh: "10月" },
  "events.month.10": { en: "Nov", zh: "11月" },
  "events.month.11": { en: "Dec", zh: "12月" },

  // ── Landing page animated questions ──
  "landing.q.fence": { en: "Do I need a permit for a fence?", zh: "安装围栏需要许可证吗？" },
  "landing.q.library": { en: "When is the next library event?", zh: "下次图书馆活动是什么时候？" },
  "landing.q.parking": { en: "What are the parking rules overnight?", zh: "夜间停车规定是什么？" },
  "landing.q.swim": { en: "Where can I sign my kid up for swim lessons?", zh: "哪里可以给孩子报名游泳课？" },
  "landing.q.pothole": { en: "How do I report a pothole?", zh: "如何报告路面坑洞？" },
  "landing.q.basement": { en: "Can I rent out my basement?", zh: "我可以出租地下室吗？" },
  "landing.q.noise": { en: "What's the noise ordinance after 10pm?", zh: "晚上10点后的噪音条例是什么？" },
  "landing.q.senior": { en: "Are there senior programs nearby?", zh: "附近有老年人项目吗？" },
  "landing.q.trash": { en: "What day is trash pickup?", zh: "哪天收垃圾？" },
  "landing.q.restaurants": { en: "Best restaurants in Great Neck?", zh: "大颈最好的餐厅有哪些？" },
  "landing.q.school": { en: "How are the local school ratings?", zh: "当地学校评分怎么样？" },
  "landing.q.tax": { en: "When are property taxes due?", zh: "房产税截止日期是什么时候？" },
  "landing.q.park": { en: "Which parks have playgrounds?", zh: "哪些公园有游乐场？" },
"landing.q.dog": { en: "Are dogs allowed in the parks?", zh: "公园里可以带狗吗？" },
  "landing.q.pool": { en: "How do I get a pool permit?", zh: "如何获得泳池许可证？" },
  "landing.q.weekend": { en: "What's happening this weekend?", zh: "这个周末有什么活动？" },
  "landing.q.ice": { en: "Is the ice rink open tonight?", zh: "今晚溜冰场开放吗？" },
  "landing.q.recycle": { en: "What can I put in recycling?", zh: "哪些东西可以回收？" },
  "landing.q.camp": { en: "Any summer camps for kids?", zh: "有儿童夏令营吗？" },
  "landing.q.waterpark": { en: "When does the Parkwood Pool open?", zh: "Parkwood泳池什么时候开放？" },
  "landing.q.poolfee": { en: "How much is the pool membership fee?", zh: "泳池会员费多少钱？" },

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
  "sidebar.signInApple": {
    en: "Sign in with Apple",
    zh: "使用 Apple 登录",
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
  "theme.classic": { en: "Classic", zh: "经典" },
  "theme.ocean": { en: "Ocean", zh: "海洋" },
  "theme.hamptons": { en: "Hamptons", zh: "汉普顿" },
  "theme.coral": { en: "Coral", zh: "珊瑚" },
  "theme.nord": { en: "Nord", zh: "北欧" },
  "theme.sage": { en: "Sage", zh: "青翠" },

  // ── Nav ──
  "nav.chat": { en: "Chat", zh: "对话" },
  "nav.ask": { en: "ask", zh: "提问" },

  // ── Auth ──
  "auth.signIn": { en: "Sign in", zh: "登录" },
  "auth.signInGoogle": { en: "Sign in with Google", zh: "使用 Google 登录" },
  "auth.signInApple": { en: "Sign in with Apple", zh: "使用 Apple 登录" },
  "auth.signOut": { en: "Sign out", zh: "退出" },

  // ── Tier / Usage ──
  "tier.trialExhaustedTitle": {
    en: "Want to keep going?",
    zh: "想继续提问吗？",
  },
  "tier.trialExhaustedDesc": {
    en: "Each answer costs us real AI resources. We limit guest access so we can keep this available for the community. Get 10 more questions below, or sign in for unlimited access.",
    zh: "每次回答都会消耗AI资源。我们限制访客使用量，以便为社区持续提供服务。点击下方获取10次额外提问，或登录以获得无限使用。",
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
  "tier.signInGoogle": {
    en: "Sign in with Google",
    zh: "使用 Google 登录",
  },
  "tier.signInApple": {
    en: "Sign in with Apple",
    zh: "使用 Apple 登录",
  },
  "tier.signInUnlimited": {
    en: "Sign in",
    zh: "登录",
  },
  "tier.dismiss": {
    en: "Maybe later",
    zh: "以后再说",
  },
  "tier.sponsorOnly": {
    en: "Sponsor feature",
    zh: "赞助者功能",
  },
  "tier.promoBanner": {
    en: "Sponsor features active — {days} days remaining",
    zh: "赞助者功能已激活 — 剩余 {days} 天",
  },
  "tier.deepLocked": {
    en: "Deep mode is a sponsor feature",
    zh: "深度模式为赞助者功能",
  },
  "tier.unlimitedSearchLocked": {
    en: "Unlimited search is a sponsor feature",
    zh: "无限搜索为赞助者功能",
  },

  // ── Email draft ──
  "email.copyEmail": { en: "Copy Email", zh: "复制邮件" },
  "email.copied": { en: "Copied!", zh: "已复制！" },
  "email.openMail": { en: "Open in Mail", zh: "打开邮件" },

  // ── Image annotator ──
  "annotate.title": { en: "Mark the area", zh: "标记区域" },
  "annotate.clear": { en: "Clear", zh: "清除" },
  "annotate.done": { en: "Done", zh: "完成" },
  "annotate.skip": { en: "Skip", zh: "跳过" },

  // ── Invite ──
  "invite.title": { en: "Invite Only", zh: "邻里专属" },
  "invite.subtitle": {
    en: "greatneck.ai is currently available by invitation only.",
    zh: "目前仅限受邀的大颈小伙伴使用哦~",
  },
  "invite.placeholder": { en: "Enter invite code", zh: "粘贴邀请码" },
  "invite.enter": { en: "Enter", zh: "进入" },
  "invite.invalid": { en: "Invalid invite code", zh: "邀请码不对哦，再看看？" },
  "invite.used": { en: "This invite code has already been used", zh: "这个码已经被用过啦" },
  "invite.needInvite": {
    en: "Have an invite code? Enter it above. Or ask a member to share one with you.",
    zh: "有码直接输入~ 没有的话找邻居要一个吧！",
  },
  "invite.alreadyMember": { en: "Already a member? Sign in", zh: "已经是老用户了？直接登录" },
  "invite.generate": { en: "Generate Invite", zh: "生成邀请码" },
  "invite.remaining": { en: "{n} of {total} remaining", zh: "还剩 {n}/{total} 个" },
  "invite.unlimited": { en: "Unlimited", zh: "不限量" },
  "invite.copied": { en: "Copied!", zh: "已复制！" },
  "invite.friends": { en: "Invite Friends", zh: "邀请邻居" },
  "invite.available": { en: "Available", zh: "可用" },
  "invite.redeemed": { en: "Used", zh: "已使用" },
  "invite.shareNeighbors": { en: "Share with neighbors!", zh: "分享给邻居！" },
  "invite.copyCode": { en: "Copy Code", zh: "复制邀请码" },
  "invite.copyLink": { en: "Copy Link", zh: "复制链接" },
  "invite.share": { en: "Share", zh: "分享" },
  "invite.shareText": {
    en: "Join me on greatneck.ai — your AI community assistant for Great Neck! Use invite code: {code}",
    zh: "来试试 greatneck.ai 吧！大颈社区AI助手，邀请码：{code}",
  },
  "invite.noInvites": { en: "No invites yet", zh: "还没有邀请码" },

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
