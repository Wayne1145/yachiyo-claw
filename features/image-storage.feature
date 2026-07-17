@P1 @storage
Feature: 图片与 Blob 存储

  作为用户，应用中所有图片 (生成的、上传的头像、聊天中收到的)
  都应该正确存储在本地 IndexedDB 中，
  切换会话或重启应用后仍然能加载显示。

  Background:
    Given 用户已打开应用 (http://localhost:1212)

  # ============================================
  #  聊天中的图片存储与加载
  # ============================================

  @BLOB-001
  Scenario: 聊天中生成的图片在切换会话后仍可加载
    Given 用户在绘图会话中已成功生成过图片
    When 用户切换到另一个会话
    And 再切换回包含图片的绘图会话
    Then 之前生成的图片应该正确加载显示
    And 不应该出现 broken image 图标 (BrokenImageOutlinedIcon)
    And 不应该出现持续的加载转圈 (CircularProgress)

  @BLOB-002
  Scenario: 图片加载中显示 loading 状态
    Given 用户打开一个包含图片消息的会话
    When 图片数据正在从 IndexedDB 加载
    Then 应该显示加载指示器 (CircularProgress 转圈)
    And 加载完成后自动替换为实际图片

  @BLOB-003
  Scenario: 图片数据丢失时显示 broken image
    Given 会话中引用了一张已不存在于存储中的图片
    When 用户查看该消息
    Then 应该显示 broken image 图标 (BrokenImageOutlinedIcon)
    And 不应该出现空白区域或报错

  # ============================================
  #  头像上传与存储
  # ============================================

  @BLOB-004
  Scenario: 上传用户头像
    Given 用户打开设置页面 (/settings) 的聊天设置 (Chat 标签)
    When 用户点击用户头像区域上传一张图片
    Then 头像图片应该立即显示在设置页面
    And 返回聊天界面后，用户消息旁的头像应该更新为新上传的图片

  @BLOB-005
  Scenario: 上传会话助手头像
    Given 用户打开某个会话的设置 (Session Settings)
    When 用户点击助手头像区域上传一张图片
    Then 助手头像应该立即更新显示
    And 该会话中所有助手消息旁的头像应该变为新头像
    And 其他会话的助手头像不应该受影响

  @BLOB-006
  Scenario: 头像在重启应用后保持
    Given 用户已上传过自定义用户头像
    When 用户关闭并重新打开应用 (刷新页面 http://localhost:1212)
    Then 用户头像应该仍然显示为自定义图片
    And 不应该回退到默认头像

  # ============================================
  #  InputBox 图片附件
  # ============================================

  @BLOB-007
  Scenario: 通过粘贴添加图片附件
    Given 用户焦点在输入框中
    When 用户从剪贴板粘贴一张图片
    Then 输入框下方应该显示图片附件预览 (Attachments 组件)
    And 图片数据应该被正确存储

  @BLOB-008
  Scenario: 通过拖拽添加图片附件
    Given 用户在聊天界面
    When 用户将一张图片文件拖拽到输入框区域
    Then 应该显示拖拽放置提示
    And 放置后输入框下方应该显示图片附件预览
    And 图片数据应该被正确存储

  @BLOB-009
  Scenario: 发送带图片附件的消息
    Given 用户已在输入框添加了图片附件
    And 用户在输入框中输入了文本 "描述一下这张图片"
    When 用户点击发送
    Then 用户消息气泡中应该同时显示文本和图片附件
    And 助手应该能够识别图片内容并给出相关回复
