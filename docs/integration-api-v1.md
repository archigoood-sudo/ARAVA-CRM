# ARAVA Integration API v1

## Назначение

ARAVA CRM остаётся локальной offline-first системой и источником истины. Сервер получает ограниченные проекции через HTTPS и никогда не подключается к `arava.db` напрямую. Базовый путь — `/api/integration/v1`; несовместимые изменения требуют новой версии.

## Подключение и аутентификация

`POST /pair` принимает `{ apiVersion: "v1", deviceId, pairingCode }` и возвращает `{ apiVersion: "v1", deviceStatus: "ACTIVE", deviceToken }`. Код одноразовый, токен ограничен одним устройством и поддерживает отзыв/ротацию. Пароли CRM не передаются.

Последующие запросы содержат:

- `Authorization: Bearer <device-token>`;
- `X-ARAVA-Device-ID: <uuid>`;
- `X-ARAVA-API-Version: v1`.

Токен хранится Electron `safeStorage` вне SQLite, не журналируется и не возвращается renderer-процессу.

## Endpoints

- `POST /pair` — регистрация устройства.
- `GET /health` — версия API, время сервера, состояние регистрации.
- `GET /device/status` — `ACTIVE`, `REVOKED` или `ROTATION_REQUIRED`.
- `POST /sync` — одна идемпотентная операция.
- `POST /sync/batch` — до 25 операций.

Batch-запрос содержит `apiVersion`, `deviceId` и `operations`. Каждая операция содержит `entityType`, `entityId`, `operation`, `version`, `updatedAt`, `idempotencyKey`, `payload`. Успешный ответ содержит `apiVersion`, `serverTimestamp` и массив `accepted` с `entityId`, `version`, `idempotencyKey` для каждой операции. CRM отмечает запись `SYNCED` только после полного валидного подтверждения.

## Ошибки

Формат: `{ "code": "DEVICE_REVOKED", "message": "..." }`.

Коды: `AUTH_REQUIRED`, `DEVICE_REVOKED`, `VALIDATION_ERROR`, `VERSION_UNSUPPORTED`, `CONFLICT`, `RATE_LIMITED`, `TEMPORARY_ERROR`.

Timeout, network error, HTTP 429 и 5xx повторяются с backoff. Ошибки данных, версии и авторизации остаются в журнале без агрессивных повторов. `DEVICE_REVOKED` очищает токен, но сохраняет outbox.

## Сущности и разрешённые поля

- `BRANCH`: `id`, `name`, `isActive`, `archivedAt`, `updatedAt`.
- `ROOM`: `id`, `branchId`, `name`, `capacity`, `isActive`, `updatedAt`.
- `TRAINER`: `id`, `displayName`, `isActive`, `directions`, `activeGroupIds`, `updatedAt`.
- `GROUP`: идентификатор, публичные параметры, филиал, тренеры, статус.
- `STUDENT_IDENTITY`: `id`, имя, фамилия, филиал, статус, активные группы.
- `GROUP_MEMBERSHIP`: ссылки student/group, активность, статус и даты.
- `SCHEDULE`: ссылки group/branch/room/coach, weekday/time/validity/status.
- `LESSON`: безопасные ссылки, начало/окончание и статус.

Исключены: `passwordHash`, временные пароли, recovery-коды, `securityVersion`, sessions, токены, телефоны/email учеников, контакты родителей, заметки, медицинские данные, audit, платежи, возвраты, долги, зарплата и платёжные данные.

## Outbox, порядок и конфликты

SQLite-триггеры создают outbox-запись в той же транзакции, что локальное изменение. Один worker отправляет до 25 операций: филиалы → залы → тренеры → группы → ученики → расписание → занятия → членства. Сервер обязан дедуплицировать `idempotencyKey` и допускать повторный UPSERT.

В v1 направление — CRM → сервер. CRM является источником истины; двусторонний merge не реализован. Первичная синхронизация создаёт отдельные операции; занятия ограничены 30 днями истории и 180 днями будущего. Интернет-сбой не отменяет локальную операцию.

Worker запускается после инициализации приложения и может продолжать отправку уже подготовленных безопасных операций после выхода CRM-пользователя. Он аутентифицируется только credential устройства и не имеет доступа к паролям пользователей. Выход из учётной записи не удаляет регистрацию устройства.

## Backup и устройство

Outbox и журнал входят в SQLite backup. Device ID и токен находятся вне БД: перенос backup не клонирует авторизацию, на новом компьютере требуется подключение. Восстановленная очередь сохраняется.

## Подготовлено, но не реализовано

- 4.4B: данные личного кабинета;
- 4.4C: приватный и групповой чат; групповой доступ определяется активным `GROUP_MEMBERSHIP`;
- 4.4D: публикации для всех клиентов, филиалов, групп и тренеров;
- 4.4E: ограниченные действия сайт → CRM.

В 4.4A нет чатов, публикаций, интернет-платежей, редактирования профиля или посещаемости с сайта.
