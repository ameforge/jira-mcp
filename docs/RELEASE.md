# Hướng dẫn Release

## Yêu cầu

- Node.js 18+
- pnpm
- Đã cài dependencies: `pnpm install`

## Quy trình release

1. Chạy release (thủ công, khi sẵn sàng):

   ```bash
   pnpm release
   ```

   release-it sẽ thực hiện tự động:
   - Chạy lint, test và build để kiểm tra
   - Hỏi phiên bản mới (patch/minor/major)
   - Commit với message "chore: release v${version}"
   - Tạo git tag "v${version}"
   - Push commit và tag lên GitHub
   - Mở trang tạo GitHub release (cần điền thủ công trong browser)

   Commit mọi thay đổi trước khi chạy: `.release-it.json` đặt `requireCleanWorkingDir: true`, nên release-it dừng lại nếu working tree chưa sạch. Bước commit version, tag và push thì release-it tự làm.

2. Kiểm tra nhanh sau build (`pnpm build` chạy rsbuild theo `rsbuild.config.mjs`, bundle `src/index.js` thành file duy nhất `dist/index.js`, kèm shebang `#!/usr/bin/env node`):

   ```bash
   node dist/index.js
   ```

   Server phải khởi động và log ra stderr (stdout chỉ dành cho giao thức MCP), không có lỗi.

## Kênh phát hành

Các kênh cài đặt cho người dùng:

### npm (khuyến nghị)

```bash
npx -y g-jira-mcp@latest
```

Package publish trên npm với tên `g-jira-mcp` (tên `jira-mcp` đã bị chiếm bởi tài khoản khác). `.release-it.json` để `npm.publish: false`, nên `pnpm release` không tự publish npm; cần publish riêng sau khi release.

## Checklist trước `pnpm release`

- [ ] Kiểm tra `.env` không bị commit (đã có trong `.gitignore`)
- [ ] README/docs tools/params phản ánh đúng code hiện tại
- [ ] Local branch updated, tất cả changes đã commit

release-it sẽ tự động:

- [ ] Chạy lint, test và build
- [ ] Bump version trong package.json
- [ ] Commit, tag, push
- [ ] Mở browser để tạo GitHub release (copy changelog + submit form)

Sau khi release xong, chạy `npm publish` (script `prepare` tự build lại `dist/index.js`).
