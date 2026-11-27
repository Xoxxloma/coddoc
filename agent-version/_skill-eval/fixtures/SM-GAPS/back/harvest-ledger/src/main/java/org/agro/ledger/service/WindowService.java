package org.agro.ledger.service;

import java.time.LocalDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.Decision;
import org.agro.ledger.api.model.WindowRequest;
import org.agro.ledger.domain.WeekWindow;
import org.agro.ledger.domain.WindowStatus;
import org.agro.ledger.repository.WeekWindowRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class WindowService {

  private final WeekWindowRepository windows;
  private final MailService mail;

  @Transactional
  public WeekWindow request(String number, WindowRequest req) {
    if (windows.findByAgronomistNumberAndWeekStart(number, req.getWeekStart()).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "already requested");
    }
    WeekWindow w = new WeekWindow();
    w.setAgronomistNumber(number);
    w.setWeekStart(req.getWeekStart());
    w.setReason(req.getReason());
    windows.save(w);
    mail.windowRequested(number, req.getWeekStart(), req.getReason());
    return w;
  }

  public List<WeekWindow> own(String number) {
    return windows.findByAgronomistNumberOrderByWeekStartDesc(number);
  }

  public List<WeekWindow> pending() {
    return windows.findByStatusOrderByWeekStart(WindowStatus.REQUESTED);
  }

  /** Отозвать можно только свой запрос, пока по нему нет решения; запись удаляется. */
  @Transactional
  public void cancel(String number, long id) {
    WeekWindow w = windows.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    if (!w.getAgronomistNumber().equals(number)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
    if (w.getStatus() != WindowStatus.REQUESTED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "already decided");
    }
    windows.delete(w);
  }

  @Transactional
  public void decide(long id, Decision decision) {
    WeekWindow w = windows.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    if (decision.getApprove()) {
      w.setStatus(WindowStatus.OPEN);
      w.setOpenedAt(LocalDateTime.now());
    } else {
      w.setStatus(WindowStatus.REJECTED);
    }
  }
}
