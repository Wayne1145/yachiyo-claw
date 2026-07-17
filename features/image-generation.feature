@P0 @image
Feature: 图片生成会话

  作为用户，我在绘图会话 (picture session) 中输入提示词，
  应该看到图片从加载状态到最终展示的完整流程，
  且生成的图片能正确保存和浏览。

  Background:
    Given 用户已打开应用 (http://localhost:1212)
    And 用户已配置好支持图片生成的模型 (如 DALL-E / Gemini)

  # ============================================
  #  绘图会话的图片生成
  # ============================================

  @IMG-GEN-001
  Scenario: 在绘图会话中生成图片
    Given 用户在会话列表中创建了一个新的 "绘图" 类型会话
    When 用户在输入框输入 "一只戴墨镜的柴犬在冲浪"
    And 用户点击发送按钮
    Then 用户消息气泡应该显示提示词文本
    And 助手消息区域应该出现加载指示器
    And 图片生成完成后，加载指示器消失
    And 助手消息中应该显示生成的图片 (PictureGallery 组件)
    And 图片应该正确渲染，不是 broken image

  @IMG-GEN-002
  Scenario: 生成多张图片
    Given 用户在会话设置中设置了图片生成数量为 2 或以上
    When 用户发送图片生成请求
    Then 助手消息中应该显示对应数量的图片
    And 每张图片都应该正确加载显示

  @IMG-GEN-003
  Scenario: 点击图片放大查看
    Given 助手消息中已有生成的图片
    When 用户点击其中一张图片
    Then 应该弹出图片浏览器 (PhotoSwipe gallery)
    And 图片应该以全屏或放大模式显示
    And 用户可以关闭浏览器回到会话

  @IMG-GEN-004
  Scenario: 图片生成失败时显示错误信息
    Given 用户使用的模型配额已满或 API Key 无效
    When 用户发送图片生成请求
    Then 助手消息中应该显示错误提示 (MessageErrTips 组件)
    And 不应该显示 broken image 或空白区域

  @IMG-GEN-005
  Scenario: 在绘图会话中继续生成更多图片
    Given 助手已完成一次图片生成
    When 用户继续输入新的提示词并发送
    Then 应该新增一组消息 (用户 + 助手)
    And 新的助手消息应该生成新图片
    And 之前生成的图片应该保持显示

  # ============================================
  #  Image Creator (独立图片创作器)
  # ============================================

  @IMG-CREATOR-001
  Scenario: 使用 Image Creator 生成图片
    Given 用户导航到 Image Creator 页面 (/image-creator)
    When 用户在提示词输入区域输入描述
    And 用户点击发送/生成按钮
    Then 应该显示加载状态 (LoadingShimmer)
    And 生成完成后应该在 GeneratedImagesGallery 区域显示图片
    And 图片应该正确加载，不是 broken image

  @IMG-CREATOR-002
  Scenario: Image Creator 生成历史
    Given 用户已在 Image Creator 中生成过图片
    When 用户查看历史面板 (HistoryPanel)
    Then 应该看到之前的生成记录 (HistoryItem)
    And 每条记录应该显示缩略图
    And 点击记录应该能查看对应的生成结果

  @IMG-CREATOR-003
  Scenario: Image Creator 切换模型和比例
    Given 用户在 Image Creator 页面
    When 用户点击模型选择器切换到其他图片模型
    And 用户选择不同的图片比例 (如 16:9)
    Then 设置应该被保存
    And 下次生成应该使用新的模型和比例
